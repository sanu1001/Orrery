package api

import (
	"strings"
	"testing"

	_ "github.com/sanu1001/orrery/internal/algos/all"

	"github.com/sanu1001/orrery/internal/algos"
)

// Go randomises map iteration, so building the same content in two orders and
// getting one key is a real check that the encoder sorts rather than an
// accident of insertion order. BACKEND.md 2.1 requires exactly this: the cache
// must not miss because a client serialised its JSON object differently.
func TestCacheKeyIgnoresInputOrder(t *testing.T) {
	a := algos.Args{}
	a["b"] = 2
	a["a"] = 1
	b := algos.Args{}
	b["a"] = 1
	b["b"] = 2

	ka, err := CacheKey("lcs", a, 0, "orrery/0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	kb, err := CacheKey("lcs", b, 0, "orrery/0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if ka != kb {
		t.Fatalf("key depends on map order:\n  %s\n  %s", ka, kb)
	}
}

// The engine is in the key so that bumping trace.Engine invalidates every
// cached trace without a manual purge. If this ever passes by accident, an
// engine upgrade starts serving traces the new engine would not produce.
func TestCacheKeyChangesWithEngine(t *testing.T) {
	in := algos.Args{"n": 6}
	before, _ := CacheKey("nqueens", in, 0, "orrery/0.1.0")
	after, _ := CacheKey("nqueens", in, 0, "orrery/0.2.0")
	if before == after {
		t.Fatal("engine version does not affect the cache key")
	}
}

func TestCacheKeyChangesWithSeed(t *testing.T) {
	in := algos.Args{"n": 6}
	a, _ := CacheKey("nqueens", in, 0, "orrery/0.1.0")
	b, _ := CacheKey("nqueens", in, 1734021, "orrery/0.1.0")
	if a == b {
		t.Fatal("seed does not affect the cache key -- share links would collide across seeds")
	}
}

// Hashing the RESOLVED input is what makes an empty request and an explicit
// request for the defaults share one cache entry. Hashing the raw body instead
// would miss on the single most common request there is.
func TestCacheKeyIsOverResolvedInput(t *testing.T) {
	spec, ok := algos.Lookup("nqueens")
	if !ok {
		t.Skip("nqueens not registered")
	}
	empty, err := spec.Resolve(algos.Args{})
	if err != nil {
		t.Fatal(err)
	}
	explicit, err := spec.Resolve(algos.Args{"n": empty["n"]})
	if err != nil {
		t.Fatal(err)
	}
	ke, _ := CacheKey(spec.ID, empty, 0, "orrery/0.1.0")
	kx, _ := CacheKey(spec.ID, explicit, 0, "orrery/0.1.0")
	if ke != kx {
		t.Fatalf("defaults and their explicit equivalent hash differently:\n  %s\n  %s", ke, kx)
	}
}

func TestNewIDShapeAndSpread(t *testing.T) {
	seen := map[string]bool{}
	for range 2000 {
		id, err := newID()
		if err != nil {
			t.Fatal(err)
		}
		if len(id) != idLen {
			t.Fatalf("id %q is %d chars, want %d", id, len(id), idLen)
		}
		for _, c := range id {
			if !strings.ContainsRune(idAlphabet, c) {
				t.Fatalf("id %q contains %q, which is outside the alphabet", id, c)
			}
		}
		seen[id] = true
	}
	// Not a collision test -- 2000 draws from 1e9 should simply never repeat,
	// and a repeat means the source is not doing what it claims.
	if len(seen) != 2000 {
		t.Fatalf("got %d distinct ids from 2000 draws", len(seen))
	}
}

// The alphabet excludes i, l, o and u on purpose: those are what people mistype
// when reading an id off a screen. A regression here is silent and only shows
// up as users reporting dead links.
func TestIDAlphabetExcludesLookalikes(t *testing.T) {
	if len(idAlphabet) != 32 {
		t.Fatalf("alphabet is %d chars, want 32 for base32", len(idAlphabet))
	}
	for _, c := range "ilou" {
		if strings.ContainsRune(idAlphabet, c) {
			t.Fatalf("alphabet contains the lookalike %q", c)
		}
	}
}

func TestRedactURLHidesPassword(t *testing.T) {
	got := redactURL("postgres://orrery:hunter2@localhost:5432/orrery")
	if strings.Contains(got, "hunter2") {
		t.Fatalf("password survived redaction: %s", got)
	}
	if !strings.Contains(got, "orrery") || !strings.Contains(got, "localhost:5432") {
		t.Fatalf("redaction ate more than the password: %s", got)
	}
}

// A libpq keyword string is not a URL. net/url.Parse rejects it, and a
// redactor that errors on its input just moves the problem somewhere less
// convenient.
func TestRedactURLLeavesKeywordStringsAlone(t *testing.T) {
	in := "host=localhost user=orrery dbname=orrery"
	if got := redactURL(in); got != in {
		t.Fatalf("keyword string was mangled: %s", got)
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("ORRERY_ENV", "staging")
	_, err := Load()
	if err == nil {
		t.Fatal("expected config to be rejected")
	}
	// One-at-a-time validation makes fixing a misconfigured deploy a serial
	// loop of restarts; both problems must appear in one message.
	if !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "ORRERY_ENV") {
		t.Fatalf("only some problems reported: %v", err)
	}
}

func TestProdRequiresCORSOrigins(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x/y")
	t.Setenv("ORRERY_ENV", "prod")
	t.Setenv("ORRERY_CORS_ORIGINS", "")
	if _, err := Load(); err == nil {
		t.Fatal("prod without CORS origins must fail at startup, not silently at the first browser request")
	}
}
