package api

import (
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
	cfg Config
	db  *store.DB
	q   *dbq.Queries
	log *slog.Logger
}

func New(cfg Config, db *store.DB, log *slog.Logger) *Server {
	return &Server{cfg: cfg, db: db, q: dbq.New(db.Pool), log: log}
}

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

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	r.Route("/api", func(r chi.Router) {
		r.Get("/algorithms", s.algorithms)
		r.Post("/trace", s.postTrace)
		r.Get("/trace/{key}", s.getTrace)
		r.Post("/share", s.postShare)
		r.Get("/share/{id}", s.getShare)
	})
	return r
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
			"req_id", middleware.GetReqID(r.Context()))
	})
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
