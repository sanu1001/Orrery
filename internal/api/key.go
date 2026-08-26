package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"

	"github.com/sanu1001/orrery/internal/algos"
)

// CacheKey is the content address of a trace.
//
//	sha256( algo | 0x00 | canonicalJSON(input) | 0x00 | seed | 0x00 | engine )
//
// engine is in the key so that bumping trace.Engine invalidates every cached
// trace at once. The alternative is a manual purge step at deploy time, which
// is a step someone eventually forgets, and the symptom -- stale traces served
// for an engine that no longer produces them -- looks like a rendering bug.
//
// The input hashed here is the RESOLVED input, after Spec.Resolve has applied
// defaults and coerced types. Hashing the raw request instead would give `{}`
// and `{"n":6}` different keys while they produce identical traces, so the
// cache would miss on exactly the most common request there is.
//
// canonicalJSON is just encoding/json: it sorts map keys, which is the same
// property internal/trace/json.go already relies on to call its own output
// canonical. {"a":1,"b":2} and {"b":2,"a":1} therefore hash the same.
func CacheKey(algo string, resolved algos.Args, seed int64, engine string) (string, error) {
	inp, err := json.Marshal(resolved)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(algo))
	h.Write([]byte{0})
	h.Write(inp)
	h.Write([]byte{0})
	h.Write([]byte(strconv.FormatInt(seed, 10)))
	h.Write([]byte{0})
	h.Write([]byte(engine))
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}
