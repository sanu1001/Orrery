package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/sanu1001/orrery/internal/algos"
	"github.com/sanu1001/orrery/internal/gen"
	dbq "github.com/sanu1001/orrery/internal/store/gen"
	"github.com/sanu1001/orrery/internal/trace"
)

// maxRequestBytes caps a decoded request body. Inputs are bounded by
// Spec.Inputs anyway, so anything approaching this is not a real request; the
// cap exists so that rejecting one costs a read of 64 KiB rather than of
// whatever the sender felt like sending.
const maxRequestBytes = 64 << 10

type traceReq struct {
	Algo  string         `json:"algo"`
	Input map[string]any `json:"input"`
	Seed  int64          `json:"seed"`

	// Lvl is a detail filter the PLAYER applies; it does not change the trace
	// and so is deliberately absent from the cache key. Accepted here only so
	// that a client can round-trip the whole recipe through one struct.
	Lvl int `json:"lvl"`
}

type traceResp struct {
	Key string `json:"key"`
	// RawMessage, not *trace.Trace: this hands back the producer's exact bytes
	// rather than a re-encoding of a decode. The frontend advertises that a
	// downloaded trace round-trips byte-identically, and re-marshalling here
	// would quietly make that false for anything served from cache.
	Trace json.RawMessage `json:"trace"`
}

func (s *Server) postTrace(w http.ResponseWriter, r *http.Request) {
	var req traceReq
	if !s.decode(w, r, &req) {
		return
	}
	spec, ok := algos.Lookup(req.Algo)
	if !ok {
		s.writeErr(w, http.StatusNotFound, "unknown algorithm "+req.Algo)
		return
	}
	// Spec.Resolve IS the security boundary: everything downstream trusts these
	// bounds, and a missing Max on a grid dimension is a memory-exhaustion bug.
	resolved, err := spec.Resolve(algos.Args(req.Input))
	if err != nil {
		s.writeJSON(w, http.StatusUnprocessableEntity, errBody{Error: err.Error(), Field: fieldOf(err)})
		return
	}
	key, err := CacheKey(spec.ID, resolved, req.Seed, trace.Engine)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "could not compute cache key")
		return
	}

	if row, err := s.q.GetCachedTrace(r.Context(), key); err == nil {
		raw, err := gunzip(row.Body)
		if err == nil {
			s.metrics.Inc("orrery_trace_requests_total", "algo", spec.ID, "cache", "hit")
			w.Header().Set("ETag", `"`+key+`"`)
			s.writeJSON(w, http.StatusOK, traceResp{Key: key, Trace: raw})
			return
		}
		// A corrupt cached row is our bug, not the caller's. Fall through and
		// regenerate rather than failing a request we can still serve.
		s.log.Error("corrupt cache row", "key", key, "err", err)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		// A cache that is down must not take generation down with it.
		s.log.Error("cache read", "key", key, "err", err)
	}

	s.metrics.Inc("orrery_trace_requests_total", "algo", spec.ID, "cache", "miss")
	// Timed with a defer so the FAILURE paths are measured too. A histogram
	// that only records successes reports a healthy p99 for a server that is
	// timing out, which is the opposite of what it is for.
	done := s.metrics.Timer("orrery_trace_generate_seconds", "algo", spec.ID)
	t, err := gen.Generate(spec.ID, resolved, req.Seed, s.cfg.TraceDeadline)
	done()
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// A trace that fails its own validator is an engine bug and never the
	// caller's fault, so it is a 500 and it is logged loudly. BACKEND.md 2.1.
	if ds := trace.Validate(t); trace.HasErrors(ds) {
		s.log.Error("generated an invalid trace", "algo", spec.ID, "diagnostics", len(ds))
		s.writeErr(w, http.StatusInternalServerError, "generated trace is invalid -- this is a bug in Orrery, not in your input")
		return
	}
	raw, err := trace.Encode(t)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "could not encode trace")
		return
	}

	// Cache writes are best effort. Failing the request because the cache is
	// unavailable would make an optimisation into a dependency.
	if body, err := gzipBytes(raw); err == nil {
		if err := s.q.PutCachedTrace(r.Context(), dbq.PutCachedTraceParams{
			Key: key, Body: body, Bytes: int32(len(raw)), Algo: spec.ID, Engine: trace.Engine,
		}); err != nil {
			s.log.Error("cache write", "key", key, "err", err)
		}
	}

	w.Header().Set("ETag", `"`+key+`"`)
	s.writeJSON(w, http.StatusOK, traceResp{Key: key, Trace: raw})
}

// getTrace is content-addressed and therefore immutable: the key is a hash of
// everything that determines the bytes, so a second visitor to a shared link
// can be served by a CDN edge and this server never sees the request.
func (s *Server) getTrace(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	row, err := s.q.GetCachedTrace(r.Context(), key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.writeErr(w, http.StatusNotFound, "no trace cached under that key")
			return
		}
		s.writeErr(w, http.StatusInternalServerError, "cache read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+key+`"`)

	// Stored gzipped and served gzipped, with no round trip through the
	// uncompressed form -- that is the whole reason body is BYTEA rather than
	// a TOASTed JSONB. A client that cannot take gzip is rare enough to pay
	// for its own decompression.
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		_, _ = w.Write(row.Body)
		return
	}
	raw, err := gunzip(row.Body)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "corrupt cache entry")
		return
	}
	_, _ = w.Write(raw)
}

func (s *Server) decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		s.writeErr(w, http.StatusBadRequest, "malformed request: "+err.Error())
		return false
	}
	return true
}

// fieldOf pulls the input name out of a Resolve error, which formats as
// "name: message". The frontend puts the message against the right form field,
// and a 422 that cannot say WHICH field is barely better than a 400.
func fieldOf(err error) string {
	if i := strings.Index(err.Error(), ":"); i > 0 {
		return err.Error()[:i]
	}
	return ""
}

func gzipBytes(b []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(b); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func gunzip(b []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return io.ReadAll(zr)
}
