.PHONY: help test vet fuzz traces golden conformance webtest run web build check clean

help:           ## show this
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

check: vet test conformance webtest  ## everything CI runs

test:           ## go test with the race detector
	go test -race ./...

vet:            ## go vet
	go vet ./...

fuzz:           ## 60s of fuzzing on the trace decoder (must never panic)
	go test ./internal/trace -run=Fuzz -fuzz=FuzzDecodeValidate -fuzztime=60s

golden:         ## regenerate the committed golden fixtures, then review the diff
	go test ./internal/replay -update

traces:         ## generate the static traces + catalogue the frontend ships with
	@mkdir -p web/public/traces
	@go run ./cmd/orrery catalog -o web/public/algorithms.json
	@for a in $$(go run ./cmd/orrery ls --ids); do \
		go run ./cmd/orrery trace $$a -o web/public/traces/$$a.json 2>/dev/null; \
	done
	@go run ./cmd/orrery complexity -o web/public/complexity.json
	@echo "wrote $$(ls web/public/traces | wc -l) traces + the catalogue + growth curves"

conformance:    ## the Go player vs the JS player, step by step, on every golden
	@./scripts/conformance.sh

webtest:        ## JS-side tests: tidy-tree, graph layout, the player, screen-reader speech
	@cd web && node scripts/tidytree.test.mjs && node scripts/tree.test.mjs && node scripts/player.test.mjs && node scripts/announce.test.mjs && node scripts/source.test.mjs && node scripts/density.test.mjs && node scripts/family.test.mjs && node scripts/tokenize.test.mjs && node scripts/graph.test.mjs

run:            ## the API server (optional -- the app works without it)
	@# orreryd reads real env vars, never a file: BACKEND.md 8 rejects a config
	@# file as a second source of truth. Sourcing .env here is a DEV convenience
	@# that keeps that true of the binary while saving an export per shell.
	@set -a; if [ -f .env ]; then . ./.env; fi; set +a; go run ./cmd/orreryd

web:            ## the vite dev server
	cd web && npm run dev

build:          ## both binaries and the frontend
	go build -o bin/orrery  ./cmd/orrery
	go build -o bin/orreryd ./cmd/orreryd
	cd web && npm ci && npm run build

clean:
	rm -rf bin dist web/dist tmp
