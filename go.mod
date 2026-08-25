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
go 1.24

// internal/trace stays stdlib-only; deps_test.go enforces it in CI.
// The server (cmd/orreryd, not yet built) will add chi + pgx + sqlc here.
