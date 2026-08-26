// Package store is the Postgres layer: a pgx pool, the embedded migrations,
// and the sqlc-generated queries.
//
// There is no ORM and there is not going to be one. The whole surface is two
// tables and about six queries, all of which are more legible as SQL than as a
// query builder, and sqlc gives them types without giving them a runtime.
package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sanu1001/orrery/internal/store/gen"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type DB struct {
	Pool *pgxpool.Pool
}

// Open dials Postgres and verifies the connection before returning, so a bad
// DATABASE_URL fails at startup with a clear message rather than on the first
// request with a stack trace. pgxpool is lazy by default; that laziness turns a
// config error into a runtime error, which is the wrong trade for a server.
func Open(ctx context.Context, url string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("store: bad DATABASE_URL: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &DB{Pool: pool}, nil
}

func (d *DB) Close() { d.Pool.Close() }

// Ready is the /readyz probe. The 250ms budget is the point: a pool that cannot
// hand out a connection within a quarter second is a pool behind a dead or
// saturated database, and reporting that as unready sheds traffic to a healthy
// instance instead of queueing it behind a stall.
func (d *DB) Ready(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	return d.Pool.Ping(ctx)
}

// Migrate applies the embedded migrations.
//
// golang-migrate's postgres driver takes a session-level advisory lock for the
// duration, so several instances booting at once serialise instead of racing,
// and the losers see ErrNoChange. That is why this is safe to run
// unconditionally on every start rather than from a separate deploy step --
// and a separate deploy step is a thing people forget to run.
func (d *DB) Migrate(ctx context.Context, url string) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("store: read migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, pgxURL(url))
	if err != nil {
		return fmt.Errorf("store: migrate init: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("store: migrate up: %w", err)
	}
	return nil
}

// pgxURL retargets a libpq URL at golang-migrate's pgx/v5 driver, which
// registers itself under its own scheme. One connection string in the
// environment, two consumers that disagree about what to call the scheme.
func pgxURL(url string) string {
	for _, p := range []string{"postgres://", "postgresql://"} {
		if strings.HasPrefix(url, p) {
			return "pgx5://" + strings.TrimPrefix(url, p)
		}
	}
	return url
}

// Queries exposes the sqlc-generated query set. It is a function rather than a
// field so that DB stays the only thing holding the pool: two owners of a pool
// is how you end up with one of them closing it.
func Queries(d *DB) *gen.Queries { return gen.New(d.Pool) }
