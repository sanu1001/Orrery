package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/sanu1001/orrery/internal/gen"
	"github.com/sanu1001/orrery/internal/store"
	dbq "github.com/sanu1001/orrery/internal/store/gen"
)

type Server struct {
	cfg     Config
	db      *store.DB
	q       *dbq.Queries
	log     *slog.Logger
	lim     *Limiter
	metrics *Registry
}

func New(cfg Config, db *store.DB, log *slog.Logger) *Server {
	return &Server{
		cfg: cfg, db: db, q: dbq.New(db.Pool), log: log,
		lim:     NewLimiter(),
		metrics: NewRegistry(),
	}
}

// Close releases what New started. Only the limiter's reaper, today.
func (s *Server) Close() { s.lim.Close() }

// Budgets, and the reason there is more than one: the two workloads cost three
// orders of magnitude apart. A cached trace is a database read; a share writes
// a row that stays. One shared allowance would either throttle the cheap path
// to protect the expensive one or fail to protect it at all. BACKEND.md 4.
var (
	budgetTrace   = Budget{PerMin: 30, Burst: 10}
	budgetShare   = Budget{PerMin: 10, Burst: 5}
	budgetDefault = Budget{PerMin: 120, Burst: 30}
)

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(s.logRequests)
	r.Use(s.cors)

	// Deliberately NOT middleware.RealIP. It rewrites RemoteAddr from the
	// LEFTMOST X-Forwarded-For value, which is the one a client controls
	// directly -- the classic spoof. Rate limiting (E2) needs a client IP and
	// will parse XFF from the right against a configured proxy CIDR instead.
	// Installing RealIP now would mean E2 silently inherits the bypass.

	// The probes and the scrape are NOT rate-limited. They are called on a
	// fixed schedule by infrastructure that is not the threat, and a liveness
	// probe that gets a 429 gets the container killed -- turning the limiter
	// into an outage rather than a defence.
	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)
	r.Get("/metrics", s.metricsHandler)

	r.Route("/api", func(r chi.Router) {
		// The budget is attached per ROUTE rather than derived from the path,
		// because the path carries ids: a limiter keyed by /api/share/abc123
		// never sees the same key twice and therefore never limits anything.
		r.With(s.limit("read", budgetDefault)).Get("/algorithms", s.algorithms)
		r.With(s.limit("trace", budgetTrace)).Post("/trace", s.postTrace)
		r.With(s.limit("read", budgetDefault)).Get("/trace/{key}", s.getTrace)
		r.With(s.limit("share", budgetShare)).Post("/share", s.postShare)
		r.With(s.limit("read", budgetDefault)).Get("/share/{id}", s.getShare)
	})
	return r
}

// metricsHandler serves the Prometheus text exposition format.
//
// Unauthenticated, and that is a deployment decision rather than an oversight:
// nothing here is a secret -- four counters and a latency histogram over public
// endpoints -- and the alternative, a bearer token in yet another environment
// variable, protects nothing while adding a way for the scrape to break
// silently. If this ever carries anything sensitive, bind it to a second
// listener rather than bolting auth onto the public one.
func (s *Server) metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	s.metrics.Write(w)
}

// healthz is liveness: the process is up. It must not touch Postgres. A
// liveness probe that checks a dependency gets the container KILLED when that
// dependency blips, turning a recoverable database hiccup into a restart loop.
func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

// readyz is readiness: this instance can serve. It DOES check Postgres, so a
// stalled pool sheds traffic to a healthy instance instead of queueing behind
// it. That is the whole reason the two endpoints are separate.
func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	if err := s.db.Ready(r.Context()); err != nil {
		s.writeErr(w, http.StatusServiceUnavailable, "database is not reachable")
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ready\n"))
}

// algorithms serves the same catalogue the build writes to algorithms.json,
// from the same function, so the static path and the API cannot disagree.
func (s *Server) algorithms(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	s.writeJSON(w, http.StatusOK, gen.Catalog())
}

// cors is hand-rolled and exact-match. go-chi/cors is one more module for
// about twenty lines, and the wildcard it makes easy is the thing to avoid on
// an API that writes rows.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := slices.Contains(s.cfg.CORSOrigins, origin)
		// In dev the frontend is on a vite port that changes; prod requires the
		// list, which Config.Load enforces at startup rather than here.
		if s.cfg.Env == "dev" && origin != "" {
			allowed = true
		}
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		s.log.Info("request",
			"method", r.Method, "path", r.URL.Path,
			"status", ww.Status(), "bytes", ww.BytesWritten(),
			"dur_ms", time.Since(start).Milliseconds(),
			"ip_hash", s.ipHash(r),
			"req_id", middleware.GetReqID(r.Context()))
	})
}

// ipHash is what goes in the log instead of the address.
//
// There is no reason for this project to retain visitor IPs, and being able to
// say so plainly is worth more than the data would be. Salted, because an
// unsalted hash of an IPv4 address is not anonymised at all -- the whole space
// is 2^32 and a rainbow table over it is minutes of work. Truncated to twelve
// hex characters, which is enough to correlate two requests within one log and
// not enough to be worth attacking.
func (s *Server) ipHash(r *http.Request) string {
	sum := sha256.Sum256([]byte(s.cfg.IPSalt + "\x00" + s.clientIP(r)))
	return hex.EncodeToString(sum[:])[:12]
}

func (s *Server) writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		s.log.Error("encode response", "err", err)
	}
}

type errBody struct {
	Error string `json:"error"`
	Field string `json:"field,omitempty"`
}

func (s *Server) writeErr(w http.ResponseWriter, code int, msg string) {
	s.writeJSON(w, code, errBody{Error: msg})
}
