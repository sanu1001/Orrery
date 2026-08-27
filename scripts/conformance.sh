#!/usr/bin/env bash
# The Go replayer and the JS player must agree about state at every step of
# every golden trace. If they ever disagree, this fails with the step number.
#
# This is the mechanism that keeps two independent implementations of the format
# honest, and it is the single thing that makes this a protocol project rather
# than a UI project. A format specified by ONE implementation is a format
# specified by nothing. ENGINE.md 7.3.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p tmp
go run ./cmd/orrery hash --all-steps testdata/golden/*.orrery.json > tmp/go.hashes
node web/scripts/hash.mjs               testdata/golden/*.orrery.json > tmp/js.hashes

if diff -u tmp/go.hashes tmp/js.hashes > tmp/conformance.diff; then
  echo "conformance OK — $(wc -l < tmp/go.hashes | tr -d ' ') step hashes matched across $(ls testdata/golden/*.json | wc -l | tr -d ' ') traces"
else
  echo "CONFORMANCE FAILED — the Go and JS players disagree. '-' is Go, '+' is JS:" >&2
  head -40 tmp/conformance.diff >&2
  exit 1
fi
