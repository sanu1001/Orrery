#!/usr/bin/env bash
# Tells you what is missing before you waste time on a confusing error.
# Run from the repo root:  bash scripts/doctor.sh
cd "$(dirname "$0")/.."
ok=0
say() { printf "%-28s %s\n" "$1" "$2"; }
need() {
  if command -v "$1" >/dev/null 2>&1; then say "$1" "$($1 --version 2>&1 | head -1)"
  else say "$1" "MISSING  -> $2"; ok=1; fi
}
echo "--- toolchain ---"
need go   "https://go.dev/dl/  (need 1.24+)"
need node "https://nodejs.org  (need 20+)"

echo
echo "--- generated assets ---"
n=$(ls web/public/traces/*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" -ge 12 ]; then say "static traces" "$n present"
else say "static traces" "$n of 12 -> run: make traces"; ok=1; fi
[ -f web/public/algorithms.json ] && say "catalogue" "present" || { say "catalogue" "MISSING -> make traces"; ok=1; }
[ -d web/node_modules ] && say "node_modules" "present" || { say "node_modules" "MISSING -> cd web && npm install"; ok=1; }

echo
echo "--- committed fixtures ---"
say "golden traces" "$(ls testdata/golden/*.json 2>/dev/null | wc -l | tr -d ' ') present"

echo
[ $ok -eq 0 ] && echo "all good — run: cd web && npm run dev" || echo "fix the items marked above, then re-run"
exit $ok
