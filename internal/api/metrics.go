package api

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Metrics: four numbers, the Prometheus text format, and no client library.
//
// prometheus/client_golang is the obvious answer and it is right for a service
// with a hundred metrics. This has four (BACKEND.md 7), and the exposition
// format they are published in is a documented text format that fits in the
// function at the bottom of this file. Against ~40 transitive modules, and in a
// project whose dependency list currently fits on one screen, hand-rolling is
// the smaller thing to maintain.
//
// The trade is real and worth stating: no exemplars, no native histograms, no
// process/Go-runtime collectors. If any of those is ever wanted, swapping the
// registry for the real client is a contained change -- everything outside this
// file calls Inc and Observe.

// Registry holds counters and histograms. Safe for concurrent use, which it has
// to be: every handler writes to it.
type Registry struct {
	mu     sync.Mutex
	counts map[string]float64
	hists  map[string]*hist
	// help and kind are kept per METRIC NAME rather than per series, because
	// the text format wants exactly one HELP and one TYPE line per name and
	// repeating them makes the scrape invalid.
	help map[string]string
	kind map[string]string
	// order preserves first-seen order so a scrape is stable between calls.
	// Sorting instead would be equally stable and would bury the interesting
	// metric under the alphabet.
	order []string
}

// buckets are seconds, and the range is chosen from what this server actually
// does: a cached trace is a database read (~1ms) and a cold N-Queens generation
// is close to a second. Anything past 5s has hit TraceDeadline and is a
// truncated trace rather than a slow one.
var buckets = []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5}

type hist struct {
	counts []uint64
	sum    float64
	n      uint64
}

func NewRegistry() *Registry {
	r := &Registry{
		counts: map[string]float64{},
		hists:  map[string]*hist{},
		help:   map[string]string{},
		kind:   map[string]string{},
	}
	r.declare("orrery_trace_requests_total", "counter",
		"Trace requests, by algorithm and whether the cache served it.")
	r.declare("orrery_trace_generate_seconds", "histogram",
		"Time to generate one trace, excluding cache hits.")
	r.declare("orrery_share_created_total", "counter",
		"Share links created.")
	r.declare("orrery_ratelimit_rejected_total", "counter",
		"Requests rejected by the rate limiter, by route.")
	return r
}

func (r *Registry) declare(name, kind, help string) {
	r.kind[name] = kind
	r.help[name] = help
	r.order = append(r.order, name)
}

// Inc adds one to a counter series. Labels are alternating key/value pairs --
// `Inc(name, "algo", "lcs", "cache", "hit")` -- which is unusual for Go and
// deliberate: it makes the call site read like the metric it produces, and the
// alternative (a map literal per call) allocates on every request.
func (r *Registry) Inc(name string, labels ...string) {
	key := series(name, labels)
	r.mu.Lock()
	r.counts[key] += 1
	r.mu.Unlock()
}

// Observe records one value into a histogram series.
func (r *Registry) Observe(name string, v float64, labels ...string) {
	key := series(name, labels)
	r.mu.Lock()
	defer r.mu.Unlock()
	h := r.hists[key]
	if h == nil {
		h = &hist{counts: make([]uint64, len(buckets))}
		r.hists[key] = h
	}
	for i, b := range buckets {
		if v <= b {
			h.counts[i]++
		}
	}
	h.sum += v
	h.n++
}

// Timer returns a function that observes the elapsed time when called. The
// `defer done()` shape is what keeps the measurement honest on the error paths,
// which are the ones worth measuring.
func (r *Registry) Timer(name string, labels ...string) func() {
	start := time.Now()
	return func() { r.Observe(name, time.Since(start).Seconds(), labels...) }
}

// series renders `name{k="v",k="v"}`. Label values are escaped because one of
// them is an algorithm id from a request path, and an unescaped quote there
// would produce a scrape the collector rejects -- a metrics endpoint that can
// be broken by a crafted URL is not an improvement.
func series(name string, labels []string) string {
	if len(labels) == 0 {
		return name
	}
	var b strings.Builder
	b.WriteString(name)
	b.WriteByte('{')
	for i := 0; i+1 < len(labels); i += 2 {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(labels[i])
		b.WriteString("=")
		b.WriteString(strconv.Quote(labels[i+1]))
	}
	b.WriteByte('}')
	return b.String()
}

// Write renders the whole registry in the Prometheus text exposition format.
func (r *Registry) Write(w io.Writer) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, name := range r.order {
		fmt.Fprintf(w, "# HELP %s %s\n", name, r.help[name])
		fmt.Fprintf(w, "# TYPE %s %s\n", name, r.kind[name])
		for _, key := range keysWithPrefix(r.counts, name) {
			fmt.Fprintf(w, "%s %s\n", key, num(r.counts[key]))
		}
		for _, key := range keysWithPrefix(r.hists, name) {
			h := r.hists[key]
			base, labels := splitSeries(key)
			// `h.counts[i]` is already cumulative: Observe increments every bucket
			// the value falls under, which is exactly what `le` means.
			for i, b := range buckets {
				fmt.Fprintf(w, "%s %d\n", withLabel(base+"_bucket", labels, "le", num(b)), h.counts[i])
			}
			fmt.Fprintf(w, "%s %d\n", withLabel(base+"_bucket", labels, "le", "+Inf"), h.n)
			fmt.Fprintf(w, "%s_sum%s %s\n", base, labels, num(h.sum))
			fmt.Fprintf(w, "%s_count%s %d\n", base, labels, h.n)
		}
	}
}

func keysWithPrefix[T any](m map[string]T, name string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if k == name || strings.HasPrefix(k, name+"{") {
			out = append(out, k)
		}
	}
	// Sorted, because Go randomises map iteration and a scrape whose line order
	// changes every call is impossible to diff by hand.
	sort.Strings(out)
	return out
}

// splitSeries pulls `name{a="b"}` apart into `name` and `{a="b"}`.
func splitSeries(key string) (string, string) {
	if i := strings.IndexByte(key, '{'); i >= 0 {
		return key[:i], key[i:]
	}
	return key, ""
}

// withLabel adds one label to a rendered label set. Bucket lines carry `le`
// alongside whatever the series already had, and the two have to end up in one
// brace group.
func withLabel(base, labels, k, v string) string {
	pair := k + "=" + strconv.Quote(v)
	if labels == "" {
		return base + "{" + pair + "}"
	}
	return base + labels[:len(labels)-1] + "," + pair + "}"
}

// num formats without an exponent for the values this registry holds, and
// without a trailing ".0" for whole numbers -- both are legal in the exposition
// format, and the second is easier to read in a terminal.
func num(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}
