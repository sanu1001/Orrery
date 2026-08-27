package api

import (
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// A limiter driven by a fake clock. Sleeping for a real minute to watch a
// bucket refill would be a slow test that also fails on a loaded machine, and
// the thing under test is arithmetic over elapsed time -- so the elapsed time
// is the input.
func fakeLimiter(t *testing.T) (*Limiter, func(time.Duration)) {
	t.Helper()
	now := time.Unix(0, 0)
	l := &Limiter{buckets: map[string]*bucket{}, ttl: idle, stop: make(chan struct{})}
	l.now = func() time.Time { return now }
	t.Cleanup(l.Close)
	return l, func(d time.Duration) { now = now.Add(d) }
}

func TestLimiterSpendsTheBurstThenRefuses(t *testing.T) {
	l, _ := fakeLimiter(t)
	b := Budget{PerMin: 30, Burst: 10}

	for i := 0; i < 10; i++ {
		if !l.Allow("trace", "1.2.3.4", b) {
			t.Fatalf("request %d refused inside the burst", i+1)
		}
	}
	// THE FIRST REQUEST FROM A NEW VISITOR IS THE ONE THAT IS DEFINITELY NOT
	// ABUSE, which is why a fresh bucket starts full rather than empty. The
	// eleventh, with no time elapsed, is the one to refuse.
	if l.Allow("trace", "1.2.3.4", b) {
		t.Fatal("the burst is not a limit at all")
	}
}

func TestLimiterRefillsOverTime(t *testing.T) {
	l, advance := fakeLimiter(t)
	b := Budget{PerMin: 60, Burst: 1}

	if !l.Allow("trace", "ip", b) {
		t.Fatal("the first request was refused")
	}
	if l.Allow("trace", "ip", b) {
		t.Fatal("a burst of one allowed two")
	}
	advance(time.Second) // 60/min is one per second
	if !l.Allow("trace", "ip", b) {
		t.Fatal("a second of elapsed time bought no token back")
	}
}

func TestLimiterDoesNotBankTokensAboveTheBurst(t *testing.T) {
	l, advance := fakeLimiter(t)
	b := Budget{PerMin: 60, Burst: 3}

	advance(time.Hour) // idle for an hour
	for i := 0; i < 3; i++ {
		if !l.Allow("trace", "ip", b) {
			t.Fatalf("request %d refused after a long idle", i+1)
		}
	}
	// Without the cap, an hour of quiet would buy 3,600 requests at once, and
	// the limiter would be a delay before an unbounded burst rather than a
	// limit on one.
	if l.Allow("trace", "ip", b) {
		t.Fatal("an idle hour banked more than the burst")
	}
}

func TestLimiterKeysByRouteAndIP(t *testing.T) {
	l, _ := fakeLimiter(t)
	b := Budget{PerMin: 60, Burst: 1}

	l.Allow("trace", "a", b)
	if !l.Allow("share", "a", b) {
		t.Fatal("one IP's trace budget consumed its share budget")
	}
	if !l.Allow("trace", "b", b) {
		t.Fatal("one IP's spending limited a different IP")
	}
}

// THE REAPER IS THE PART PEOPLE FORGET. Buckets are keyed by
// attacker-controlled input, so a map that only grows is an unbounded memory
// leak reachable by anyone who can send a header.
func TestLimiterReapsIdleBuckets(t *testing.T) {
	l, advance := fakeLimiter(t)
	b := Budget{PerMin: 60, Burst: 1}

	for i := 0; i < 500; i++ {
		l.Allow("trace", net.IPv4(10, 0, byte(i/256), byte(i%256)).String(), b)
	}
	if len(l.buckets) != 500 {
		t.Fatalf("held %d buckets, want 500", len(l.buckets))
	}
	advance(idle + time.Minute)
	l.sweep()
	if len(l.buckets) != 0 {
		t.Fatalf("%d buckets survived the sweep", len(l.buckets))
	}
}

func TestLimiterZeroBudgetAllowsEverything(t *testing.T) {
	l, _ := fakeLimiter(t)
	for i := 0; i < 100; i++ {
		if !l.Allow("open", "ip", Budget{}) {
			t.Fatal("an unset budget limited something")
		}
	}
}

// ---------------------------------------------------------------------------
// client IP
// ---------------------------------------------------------------------------

func srvWithProxies(t *testing.T, cidrs ...string) *Server {
	t.Helper()
	var nets []*net.IPNet
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			t.Fatal(err)
		}
		nets = append(nets, n)
	}
	return &Server{cfg: Config{TrustedProxies: nets, IPSalt: "salt"}}
}

func req(remote, xff string) *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = remote
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	return r
}

// The classic bypass: one header and every request looks like a different
// visitor. This is the test that has to pass for the limiter to mean anything.
func TestClientIPIgnoresForwardedHeaderWithNoTrustedProxy(t *testing.T) {
	s := srvWithProxies(t)
	got := s.clientIP(req("203.0.113.9:5000", "1.1.1.1, 2.2.2.2"))
	if got != "203.0.113.9" {
		t.Fatalf("clientIP = %q, want the real peer -- a forged header was believed", got)
	}
}

func TestClientIPTakesTheRightmostUntrustedHop(t *testing.T) {
	s := srvWithProxies(t, "10.0.0.0/8")
	// The client sent "1.1.1.1" itself; our edge appended the address it saw.
	// The rightmost NON-proxy entry is the one our own infrastructure observed.
	got := s.clientIP(req("10.0.0.7:5000", "1.1.1.1, 203.0.113.9, 10.0.0.3"))
	if got != "203.0.113.9" {
		t.Fatalf("clientIP = %q, want 203.0.113.9", got)
	}
}

func TestClientIPDistrustsAnUnknownPeer(t *testing.T) {
	s := srvWithProxies(t, "10.0.0.0/8")
	// The connection did not come from our proxy fleet, so nothing it claims to
	// have forwarded can be believed.
	got := s.clientIP(req("198.51.100.5:5000", "1.1.1.1"))
	if got != "198.51.100.5" {
		t.Fatalf("clientIP = %q, want the peer", got)
	}
}

func TestClientIPFallsBackToThePeerWhenEveryHopIsOurs(t *testing.T) {
	s := srvWithProxies(t, "10.0.0.0/8")
	got := s.clientIP(req("10.0.0.7:5000", "10.0.0.3, 10.0.0.4"))
	if got != "10.0.0.7" {
		t.Fatalf("clientIP = %q, want the peer", got)
	}
}

func TestIPHashIsSaltedAndTruncated(t *testing.T) {
	a := srvWithProxies(t)
	b := &Server{cfg: Config{IPSalt: "different"}}
	r := req("203.0.113.9:5000", "")

	if a.ipHash(r) == b.ipHash(r) {
		t.Fatal("the salt does not affect the hash -- an unsalted IPv4 hash is a 2^32 lookup")
	}
	if got := a.ipHash(r); len(got) != 12 {
		t.Fatalf("ip_hash is %d characters, want 12", len(got))
	}
	if strings.Contains(a.ipHash(r), "203.0.113") {
		t.Fatal("the address survived into the log field")
	}
}

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

func TestMetricsExposition(t *testing.T) {
	r := NewRegistry()
	r.Inc("orrery_trace_requests_total", "algo", "lcs", "cache", "hit")
	r.Inc("orrery_trace_requests_total", "algo", "lcs", "cache", "hit")
	r.Inc("orrery_trace_requests_total", "algo", "lcs", "cache", "miss")
	r.Observe("orrery_trace_generate_seconds", 0.004, "algo", "lcs")
	r.Observe("orrery_trace_generate_seconds", 0.6, "algo", "lcs")

	var sb strings.Builder
	r.Write(&sb)
	out := sb.String()

	want := []string{
		"# TYPE orrery_trace_requests_total counter",
		`orrery_trace_requests_total{algo="lcs",cache="hit"} 2`,
		`orrery_trace_requests_total{algo="lcs",cache="miss"} 1`,
		"# TYPE orrery_trace_generate_seconds histogram",
		// Cumulative: 0.004 falls under every bucket from 0.005 up, 0.6 under 1.
		`orrery_trace_generate_seconds_bucket{algo="lcs",le="0.001"} 0`,
		`orrery_trace_generate_seconds_bucket{algo="lcs",le="0.005"} 1`,
		`orrery_trace_generate_seconds_bucket{algo="lcs",le="0.5"} 1`,
		`orrery_trace_generate_seconds_bucket{algo="lcs",le="1"} 2`,
		`orrery_trace_generate_seconds_bucket{algo="lcs",le="+Inf"} 2`,
		`orrery_trace_generate_seconds_count{algo="lcs"} 2`,
		`orrery_trace_generate_seconds_sum{algo="lcs"} 0.604`,
	}
	for _, w := range want {
		if !strings.Contains(out, w) {
			t.Errorf("scrape is missing:\n  %s\ngot:\n%s", w, out)
		}
	}
	// Exactly one HELP and one TYPE per metric NAME, not per series. Repeating
	// them makes the scrape invalid, and a collector rejects the whole payload
	// rather than the offending line.
	if n := strings.Count(out, "# TYPE orrery_trace_requests_total"); n != 1 {
		t.Errorf("TYPE repeated %d times", n)
	}
}

// A label value arrives from a request path, so the endpoint has to survive a
// crafted one. A metrics endpoint that a URL can break is not an improvement.
func TestMetricsEscapesLabelValues(t *testing.T) {
	r := NewRegistry()
	r.Inc("orrery_trace_requests_total", "algo", `we"ird`, "cache", "hit")
	var sb strings.Builder
	r.Write(&sb)
	if !strings.Contains(sb.String(), `algo="we\"ird"`) {
		t.Fatalf("quote not escaped:\n%s", sb.String())
	}
}

func TestMetricsOutputIsStable(t *testing.T) {
	r := NewRegistry()
	for _, a := range []string{"lcs", "bubble", "nqueens", "merge", "quick"} {
		r.Inc("orrery_trace_requests_total", "algo", a, "cache", "hit")
	}
	var a, b strings.Builder
	r.Write(&a)
	r.Write(&b)
	// Go randomises map iteration, so two scrapes of an untouched registry
	// differing would make the endpoint impossible to diff by hand.
	if a.String() != b.String() {
		t.Fatal("two scrapes of the same registry disagree")
	}
}
