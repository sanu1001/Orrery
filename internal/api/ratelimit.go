package api

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Rate limiting, and the two things about it that are easy to get wrong.
//
// THE FIRST IS THE CLIENT IP. `X-Forwarded-For` is a list that each hop
// APPENDS to, so the leftmost entry is whatever the original client sent --
// including a client that invented it. Trusting the left is the classic bypass:
// one header and every request looks like a different visitor. The right answer
// is to walk from the RIGHT, discarding hops that are inside a configured
// trusted-proxy range, and stop at the first address that is not. That address
// is the one your own infrastructure observed, and it is the last one an
// attacker cannot forge.
//
// This is also why `middleware.RealIP` is not installed anywhere in this
// server: it rewrites RemoteAddr from the leftmost value, and installing it
// would hand the limiter the spoofable number without anything looking wrong.
//
// THE SECOND IS THE MAP. Buckets are keyed by attacker-controlled input, so a
// map that only ever grows is an unbounded memory leak reachable by anyone with
// a header. The reaper is not tidiness; it is the difference between a limiter
// and a slower way to be knocked over.

// A token bucket, hand-rolled.
//
// golang.org/x/time/rate is the obvious answer and it is twenty-five lines of
// arithmetic. Against that: it is a module this project does not otherwise
// need, `internal/trace` is stdlib-only on principle, and the whole dependency
// list currently fits on one screen. The same argument that keeps the CORS
// handler hand-written applies here, and the shape below is the standard one --
// tokens accrue continuously at `rate` per second and cap at `burst`.
type bucket struct {
	tokens float64
	last   time.Time
	seen   time.Time
}

func (b *bucket) allow(now time.Time, rate, burst float64) bool {
	// Continuous refill rather than a ticker: a bucket that is not being used
	// costs nothing, and one that is only needs the elapsed time since it last
	// was. A per-bucket goroutine would be a goroutine per IP.
	b.tokens += now.Sub(b.last).Seconds() * rate
	if b.tokens > burst {
		b.tokens = burst
	}
	b.last = now
	b.seen = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Budget is one route's allowance.
type Budget struct {
	PerMin float64
	Burst  float64
}

// Limiter holds one bucket per (route, ip).
//
// Per ROUTE as well as per IP, because the two workloads cost three orders of
// magnitude apart: a cached trace is a database read, and a share writes a row.
// One shared budget would either throttle the cheap path to protect the
// expensive one or fail to protect it at all.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	ttl     time.Duration
	stop    chan struct{}
	now     func() time.Time // indirected so the tests do not sleep
}

// idle is how long an unused bucket survives. Long enough that a user pausing
// to read a page does not get a fresh burst allowance for free, short enough
// that a scan across a million forged addresses does not stay resident.
const idle = 10 * time.Minute

func NewLimiter() *Limiter {
	l := &Limiter{
		buckets: map[string]*bucket{},
		ttl:     idle,
		stop:    make(chan struct{}),
		now:     time.Now,
	}
	go l.reap()
	return l
}

// Close stops the reaper. The server runs for the life of the process so this
// matters only to tests, and a test that leaks a goroutine per case is a test
// that eventually reports something unrelated.
func (l *Limiter) Close() { close(l.stop) }

func (l *Limiter) Allow(route, ip string, b Budget) bool {
	if b.PerMin <= 0 {
		return true
	}
	key := route + "\x00" + ip
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.buckets[key]
	if e == nil {
		// A NEW BUCKET STARTS FULL. Starting empty would reject the first
		// request from every visitor, which is the one request that is
		// definitely not abuse.
		e = &bucket{tokens: b.Burst, last: now}
		l.buckets[key] = e
	}
	return e.allow(now, b.PerMin/60, b.Burst)
}

func (l *Limiter) reap() {
	t := time.NewTicker(l.ttl / 2)
	defer t.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-t.C:
			l.sweep()
		}
	}
}

func (l *Limiter) sweep() {
	cut := l.now().Add(-l.ttl)
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, e := range l.buckets {
		if e.seen.Before(cut) {
			delete(l.buckets, k)
		}
	}
}

// limit is the middleware. `route` names the budget rather than being derived
// from the path, because the path contains ids and a limiter keyed by
// `/api/share/abc123` is a limiter that never sees the same key twice.
func (s *Server) limit(route string, b Budget) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := s.clientIP(r)
			if s.lim.Allow(route, ip, b) {
				next.ServeHTTP(w, r)
				return
			}
			s.metrics.Inc("orrery_ratelimit_rejected_total", "route", route)
			// Retry-After in seconds, and a body the frontend can render inline.
			// A bare 429 with no body renders as "something went wrong", which
			// is both unhelpful and untrue.
			retry := int(60/b.PerMin) + 1
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			s.writeErr(w, http.StatusTooManyRequests,
				"that is faster than this endpoint allows -- try again in a few seconds")
		})
	}
}

// clientIP returns the address to rate-limit on: the rightmost hop in
// X-Forwarded-For that is NOT one of our own proxies, or RemoteAddr when no
// proxy is configured.
//
// With no trusted proxies configured, XFF is ignored entirely. That is the safe
// default: a server reached directly sees the real peer in RemoteAddr, and
// honouring a header nobody stripped would mean honouring a header anybody can
// send.
func (s *Server) clientIP(r *http.Request) string {
	peer := hostOf(r.RemoteAddr)
	if len(s.cfg.TrustedProxies) == 0 {
		return peer
	}
	if !inAny(peer, s.cfg.TrustedProxies) {
		// The immediate peer is not a proxy we know, so nothing it forwarded
		// can be believed.
		return peer
	}
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		hop := strings.TrimSpace(parts[i])
		if hop == "" {
			continue
		}
		if inAny(hop, s.cfg.TrustedProxies) {
			continue // one of ours; keep walking left
		}
		return hop
	}
	// Every hop was trusted, which means the request came from inside the
	// proxy fleet. The peer is as specific as it gets.
	return peer
}

func hostOf(addr string) string {
	if h, _, err := net.SplitHostPort(addr); err == nil {
		return h
	}
	return addr
}

func inAny(ip string, nets []*net.IPNet) bool {
	p := net.ParseIP(ip)
	if p == nil {
		return false
	}
	for _, n := range nets {
		if n.Contains(p) {
			return true
		}
	}
	return false
}
