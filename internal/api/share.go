package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/sanu1001/orrery/internal/algos"
	dbq "github.com/sanu1001/orrery/internal/store/gen"
	"github.com/sanu1001/orrery/internal/trace"
)

// idAlphabet is Crockford base32 in lower case: no i, l, o or u. Those four
// are the characters people mistype when copying a link out of a screenshot or
// reading one aloud, and a share id is exactly the kind of string that gets
// copied by eye. 32^6 is about 1.1e9, which is far more than this will ever
// hold; collisions are handled on insert regardless.
const idAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"

const idLen = 6

type shareReq struct {
	Algo  string         `json:"algo"`
	Input map[string]any `json:"input"`
	Seed  int64          `json:"seed"`
	Step  int            `json:"step"`
	Lvl   int            `json:"lvl"`
}

type shareResp struct {
	ID string `json:"id"`
}

type shareRecipe struct {
	Algo  string          `json:"algo"`
	Input json.RawMessage `json:"input"`
	Seed  int64           `json:"seed"`
	Step  int             `json:"step"`
	Lvl   int             `json:"lvl"`

	// Engine is the version that RECORDED the share, and RecordedElsewhere says
	// it differs from the one now running. A trace is a function of the engine,
	// so an engine change can alter what an old link resolves to -- a link in a
	// blog post drifting silently is worse than one that says it drifted.
	// BACKEND.md 2.3 takes this mitigation and rejects version pinning.
	Engine            string `json:"engine"`
	RecordedElsewhere bool   `json:"recordedElsewhere,omitempty"`
}

// postShare stores a RECIPE, never a trace: same algo, input, seed and engine
// always produce the same bytes, so a row is ~120 bytes where the trace it
// reproduces may be a megabyte. Storing the trace would put a cache entry
// inside a permalink.
func (s *Server) postShare(w http.ResponseWriter, r *http.Request) {
	var req shareReq
	if !s.decode(w, r, &req) {
		return
	}
	spec, ok := algos.Lookup(req.Algo)
	if !ok {
		s.writeErr(w, http.StatusNotFound, "unknown algorithm "+req.Algo)
		return
	}
	// Resolve before storing so a share can never be created for input the
	// server would later refuse. A permalink that 422s on open is worse than
	// one that was never issued.
	resolved, err := spec.Resolve(algos.Args(req.Input))
	if err != nil {
		s.writeJSON(w, http.StatusUnprocessableEntity, errBody{Error: err.Error(), Field: fieldOf(err)})
		return
	}
	if req.Step < 0 {
		s.writeJSON(w, http.StatusUnprocessableEntity, errBody{Error: "step must not be negative", Field: "step"})
		return
	}
	inp, err := json.Marshal(resolved)
	if err != nil {
		s.writeErr(w, http.StatusInternalServerError, "could not encode input")
		return
	}

	id, err := s.insertShare(r.Context(), dbq.CreateShareParams{
		Algo: spec.ID, Input: inp, Seed: req.Seed,
		Step: int32(req.Step), Lvl: int16(req.Lvl), Engine: trace.Engine,
	})
	if err != nil {
		s.log.Error("create share", "err", err)
		s.writeErr(w, http.StatusInternalServerError, "could not create share")
		return
	}
	s.metrics.Inc("orrery_share_created_total", "algo", spec.ID)
	s.writeJSON(w, http.StatusOK, shareResp{ID: id})
}

// insertShare retries on a primary-key collision rather than pre-checking with
// a SELECT. A check-then-insert is a race between two requests; letting the
// unique index be the arbiter is correct without a transaction. Three attempts
// is plenty: at 1e9 ids the first collision is already vanishingly unlikely,
// and a second failure means something other than luck is wrong.
func (s *Server) insertShare(ctx context.Context, p dbq.CreateShareParams) (string, error) {
	var lastErr error
	for range 3 {
		id, err := newID()
		if err != nil {
			return "", err
		}
		p.ID = id
		err = s.q.CreateShare(ctx, p)
		if err == nil {
			return id, nil
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			lastErr = err
			continue
		}
		return "", err
	}
	return "", lastErr
}

func (s *Server) getShare(w http.ResponseWriter, r *http.Request) {
	row, err := s.q.GetShare(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.writeErr(w, http.StatusNotFound, "no such share")
			return
		}
		s.writeErr(w, http.StatusInternalServerError, "could not read share")
		return
	}
	// Shares are resolved far more often than created, and the recipe for a
	// given id never changes, but the drift note depends on the engine THIS
	// instance runs -- so it is cacheable only briefly.
	w.Header().Set("Cache-Control", "public, max-age=60")
	s.writeJSON(w, http.StatusOK, shareRecipe{
		Algo:              row.Algo,
		Input:             json.RawMessage(row.Input),
		Seed:              row.Seed,
		Step:              int(row.Step),
		Lvl:               int(row.Lvl),
		Engine:            row.Engine,
		RecordedElsewhere: row.Engine != trace.Engine,
	})
}

// newID draws from crypto/rand, not math/rand. A guessable share id is a way
// to enumerate other people's links, and the cost of the strong source here is
// six bytes per share.
func newID() (string, error) {
	b := make([]byte, idLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, idLen)
	for i, v := range b {
		out[i] = idAlphabet[int(v)%len(idAlphabet)]
	}
	return string(out), nil
}
