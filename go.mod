module github.com/sanu1001/orrery

// This is a FLOOR, not a pin. Any toolchain at or above 1.24 builds this
// module -- Go 1.26, 1.27 and so on are all fine, and no toolchain download is
// triggered. Declaring a low floor is deliberate: a reviewer cloning this repo
// with an older Go can still build it.
//
// Nothing in the code needs more than 1.21 (the newest thing used is the
// `clear` builtin). 1.24 is claimed because it is also the version the
// loop-variable semantics of Go 1.22+ are wanted from -- closures in the
// algorithm package capture loop variables, and per-iteration scoping is what
// makes that safe.
go 1.24.0

// internal/trace stays stdlib-only; deps_test.go enforces it in CI.
//
// pgx is PINNED to v5.8.0, and not because anything newer is broken: v5.9+
// declares `go 1.25`, and `go get @latest` silently raises this module's go
// directive to satisfy it. That trades away the only thing the 1.24 floor buys
// -- a reviewer on an older toolchain can still build -- for a minor version
// nothing here uses. v5.8.0 is the newest pgx that declares 1.24.
//
// Revisit when something actually needs a newer pgx. Then bump the floor
// deliberately, in the same commit, with the reason written down.

require (
	github.com/golang-migrate/migrate/v4 v4.19.1
	github.com/jackc/pgx/v5 v5.8.0
)

require (
	github.com/go-chi/chi/v5 v5.3.2 // indirect
	github.com/jackc/pgerrcode v0.0.0-20220416144525-469b46aa5efa // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.18.0 // indirect
	golang.org/x/text v0.31.0 // indirect
)
