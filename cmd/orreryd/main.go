// Command orreryd is the Orrery HTTP API: trace generation, the trace cache,
// and share links.
//
// It is deliberately not load-bearing. The seventeen built-in algorithms are
// generated at build time and served as static JSON beside the bundle, so the
// app works with this process down -- on a plane, or while a free-tier
// container cold-starts. The server exists for input that was not precomputed,
// for share links, and eventually for Stage B compilation. BACKEND.md 1.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	_ "github.com/sanu1001/orrery/internal/algos/all"
	"github.com/sanu1001/orrery/internal/api"
	"github.com/sanu1001/orrery/internal/store"
)

// traceRetention is how long an unused cached trace survives. Regenerating one
// costs under a millisecond, so this is about bounding disk, not about
// preserving work -- which is why it is generous rather than tuned.
const traceRetention = 30 * 24 * time.Hour

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))

	cfg, err := api.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	log.Info("starting", "config", cfg.Redacted())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
		log.Error("migrate", "err", err)
		os.Exit(1)
	}
	log.Info("migrations applied")

	go evictLoop(ctx, db, log)

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: api.New(cfg, db, log).Routes(),

		// ReadHeaderTimeout is the slowloris defence and the only one of these
		// that matters for an attack rather than for hygiene.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,

		// WriteTimeout must exceed TraceDeadline, or a generation that runs to
		// its cap has its response cut off mid-body -- which reaches the client
		// as truncated JSON and reads as a corrupt trace rather than as a
		// timeout. The margin covers encoding and gzipping a large trace.
		WriteTimeout: cfg.TraceDeadline + 25*time.Second,
		IdleTimeout:  60 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	select {
	case err := <-errc:
		log.Error("listen", "err", err)
		os.Exit(1)
	case <-ctx.Done():
	}

	// Shutdown gets its own context: ctx is already cancelled by the signal,
	// and passing it would abort every in-flight request instantly, which is
	// the opposite of a graceful stop.
	log.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Error("shutdown", "err", err)
	}
}

// evictLoop trims cold cache rows. A ticker in-process rather than a separate
// scheduler: the work is one DELETE with no deadline and no coordination
// requirement, and a second deployable to run it would be more moving parts
// than the problem has.
func evictLoop(ctx context.Context, db *store.DB, log *slog.Logger) {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cut := pgtype.Timestamptz{Time: time.Now().Add(-traceRetention), Valid: true}
			n, err := store.Queries(db).EvictColdTraces(ctx, cut)
			if err != nil {
				log.Error("evict", "err", err)
				continue
			}
			if n > 0 {
				log.Info("evicted cold traces", "rows", n)
			}
		}
	}
}
