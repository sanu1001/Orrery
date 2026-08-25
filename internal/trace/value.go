package trace

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// Value is any legal trace value. Concretely one of:
//
//	nil | bool | float64 | string
//	Ref     -> {"$":"n7"}          a node reference
//	Record  -> {field: Value, ...} a node payload
//	Tuple   -> [Value, ...]        a small fixed list
//
// It is a type ALIAS, not a defined type, so callers can pass 7 directly.
// Validation happens once, in Validate, rather than in the type system -- the
// pragmatic choice for a format whose whole point is surviving a JSON round
// trip. A proper sum type would fight encoding/json at every step.
type Value = any

// Inf is how positive infinity is encoded. JSON has no Infinity, and the
// alternatives (a magic number like 1e308, or an {"$inf":true} wrapper) are
// worse for expr display and for diffing. Renderers special-case it.
const Inf = "inf"

// Ref is a reference to a node by id.
type Ref struct{ ID string }

func (r Ref) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string{"$": r.ID})
}

// AsRef reports whether v is a node reference, and returns its id.
func AsRef(v Value) (string, bool) {
	switch t := v.(type) {
	case Ref:
		return t.ID, true
	case map[string]any:
		if id, ok := t["$"].(string); ok {
			return id, true
		}
	case Record:
		if id, ok := t["$"].(string); ok {
			return id, true
		}
	}
	return "", false
}

// Record is a node payload. It may not contain a "$" key.
type Record map[string]Value

// Tuple is a small fixed list, e.g. a pair.
type Tuple []Value

// Num coerces a numeric Value. Reports false for anything non-numeric.
func Num(v Value) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int8:
		return float64(t), true
	case int16:
		return float64(t), true
	case int32:
		return float64(t), true
	case int64:
		return float64(t), true
	case uint:
		return float64(t), true
	case uint64:
		return float64(t), true
	}
	return 0, false
}

// Normalize converts a value into its canonical in-memory form: every number
// becomes float64, every {"$":...} becomes a Ref, every object becomes a
// Record, every array becomes a Tuple. Applied on decode and on every write, so
// that a value produced by Go code and a value read back from JSON compare and
// hash identically.
func Normalize(v Value) Value {
	if n, ok := Num(v); ok {
		return n
	}
	switch t := v.(type) {
	case nil, bool, string, Ref:
		return t
	case map[string]any:
		if id, ok := t["$"].(string); ok && len(t) == 1 {
			return Ref{ID: id}
		}
		out := make(Record, len(t))
		for k, vv := range t {
			out[k] = Normalize(vv)
		}
		return out
	case Record:
		if id, ok := t["$"].(string); ok && len(t) == 1 {
			return Ref{ID: id}
		}
		out := make(Record, len(t))
		for k, vv := range t {
			out[k] = Normalize(vv)
		}
		return out
	case []any:
		out := make(Tuple, len(t))
		for i, vv := range t {
			out[i] = Normalize(vv)
		}
		return out
	case Tuple:
		out := make(Tuple, len(t))
		for i, vv := range t {
			out[i] = Normalize(vv)
		}
		return out
	case []int:
		out := make(Tuple, len(t))
		for i, vv := range t {
			out[i] = float64(vv)
		}
		return out
	case []string:
		out := make(Tuple, len(t))
		for i, vv := range t {
			out[i] = vv
		}
		return out
	}
	return v
}

// Clone deep-copies a value. The tracer must clone on every write, because the
// event's To value would otherwise alias the state -- and unapplying would then
// mutate the event's own data. That is a subtle, expensive bug; do not remove.
func Clone(v Value) Value {
	switch t := v.(type) {
	case Record:
		out := make(Record, len(t))
		for k, vv := range t {
			out[k] = Clone(vv)
		}
		return out
	case Tuple:
		out := make(Tuple, len(t))
		for i, vv := range t {
			out[i] = Clone(vv)
		}
		return out
	}
	return v
}

// Equal is deep equality with the numeric normalisation the format requires:
// after a JSON round trip every number is a float64, so 7 and 7.0 must compare
// equal. NaN never equals anything, including itself.
func Equal(a, b Value) bool {
	an, aok := Num(a)
	bn, bok := Num(b)
	if aok || bok {
		if !aok || !bok {
			return false
		}
		if math.IsNaN(an) || math.IsNaN(bn) {
			return false
		}
		return an == bn
	}

	aid, aIsRef := AsRef(a)
	bid, bIsRef := AsRef(b)
	if aIsRef || bIsRef {
		return aIsRef && bIsRef && aid == bid
	}

	switch at := a.(type) {
	case nil:
		return b == nil
	case bool:
		bt, ok := b.(bool)
		return ok && at == bt
	case string:
		bt, ok := b.(string)
		return ok && at == bt
	case Record:
		bt := asRecord(b)
		return bt != nil && recordEqual(at, bt)
	case map[string]any:
		bt := asRecord(b)
		return bt != nil && recordEqual(Record(at), bt)
	case Tuple:
		bt, ok := asTuple(b)
		return ok && tupleEqual(at, bt)
	case []any:
		bt, ok := asTuple(b)
		return ok && tupleEqual(Tuple(at), bt)
	}
	return false
}

func asRecord(v Value) Record {
	switch t := v.(type) {
	case Record:
		return t
	case map[string]any:
		return Record(t)
	}
	return nil
}

func asTuple(v Value) (Tuple, bool) {
	switch t := v.(type) {
	case Tuple:
		return t, true
	case []any:
		return Tuple(t), true
	}
	return nil, false
}

func recordEqual(a, b Record) bool {
	if len(a) != len(b) {
		return false
	}
	for k, av := range a {
		bv, ok := b[k]
		if !ok || !Equal(av, bv) {
			return false
		}
	}
	return true
}

func tupleEqual(a, b Tuple) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !Equal(a[i], b[i]) {
			return false
		}
	}
	return true
}

// Canon renders a value in the canonical text form used by StateHash.
//
// Numbers use strconv.FormatFloat(v, 'g', -1, 64), which agrees with
// JavaScript's String(n) for every value this format can produce. The two
// known divergences -- exponent formatting above 1e21, and negative zero --
// are covered by TestCanonMatchesJS. Integers above 2^53 are forbidden by the
// format (TRACE_FORMAT.md 5), which removes the third.
func Canon(v Value) string {
	if n, ok := Num(v); ok {
		return formatNum(n)
	}
	if id, ok := AsRef(v); ok {
		return "$" + id
	}
	switch t := v.(type) {
	case nil:
		return "null"
	case bool:
		if t {
			return "true"
		}
		return "false"
	case string:
		return strconv.Quote(t)
	case Record:
		return canonRecord(t)
	case map[string]any:
		return canonRecord(Record(t))
	case Tuple:
		return canonTuple(t)
	case []any:
		return canonTuple(Tuple(t))
	}
	return "?"
}

// formatNum reproduces JavaScript's Number::toString (ECMA-262 6.1.6.1.20)
// exactly, for every finite double.
//
// This is not pedantry. The conformance suite hashes state in both languages
// and diffs the streams; if Go renders 1e20 as "1e+20" while JS renders
// "100000000000000000000", every trace containing a large number fails CI with
// a message that points at a step number rather than at the real cause. Go's
// own 'g' verb switches to exponent notation at a different threshold than JS
// does, so the shortest-round-trip digits have to be re-laid-out by hand.
//
// The algorithm: take the shortest round-trip digits and the decimal exponent,
// then apply the spec's own case analysis on (k = digit count, n = position of
// the decimal point).
func formatNum(v float64) string {
	switch {
	case math.IsNaN(v):
		return "NaN"
	case math.IsInf(v, 1):
		return "Infinity"
	case math.IsInf(v, -1):
		return "-Infinity"
	case v == 0:
		return "0" // collapses -0, exactly as String(-0) does
	}

	sign := ""
	if v < 0 {
		sign, v = "-", -v
	}

	// Shortest round-trip digits, as "d.dddde±dd".
	e := strconv.FormatFloat(v, 'e', -1, 64)
	mant, expPart, _ := strings.Cut(e, "e")
	exp, _ := strconv.Atoi(expPart)
	digits := strings.Replace(mant, ".", "", 1)
	digits = strings.TrimRight(digits, "0")
	if digits == "" {
		digits = "0"
	}
	k := len(digits) // significant digits
	n := exp + 1     // decimal point sits after n digits

	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}

	// Exponential form. JS writes e+21 / e-7: a sign, no leading zeros.
	ex := n - 1
	esign := "+"
	if ex < 0 {
		esign, ex = "-", -ex
	}
	if k == 1 {
		return sign + digits + "e" + esign + strconv.Itoa(ex)
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + esign + strconv.Itoa(ex)
}

func canonRecord(r Record) string {
	keys := make([]string, 0, len(r))
	for k := range r {
		keys = append(keys, k)
	}
	sortStrings(keys)
	out := "{"
	for i, k := range keys {
		if i > 0 {
			out += ","
		}
		out += strconv.Quote(k) + ":" + Canon(r[k])
	}
	return out + "}"
}

func canonTuple(t Tuple) string {
	out := "["
	for i, v := range t {
		if i > 0 {
			out += ","
		}
		out += Canon(v)
	}
	return out + "]"
}

// decodeValue turns a raw JSON fragment into a normalized Value.
//
// A nil RawMessage means the key was ABSENT; a RawMessage of "null" means it
// was present and null. Both produce nil here, but keeping them distinguishable
// at the wire layer is why the permissive decode target in event.go uses
// json.RawMessage rather than `any` -- with `omitempty` on a plain `any`, a
// legitimate `"from": 0` would be dropped on encode and V4 would then compare
// nil against 0 and fail.
func decodeValue(raw json.RawMessage) (Value, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return Normalize(v), nil
}
