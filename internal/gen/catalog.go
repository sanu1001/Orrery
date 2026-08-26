package gen

import "github.com/sanu1001/orrery/internal/algos"

// CatalogEntry is what the picker and the generated input form consume.
//
// It is derived entirely from Spec, which is why adding an eighteenth algorithm
// needs no frontend change: write one Go file, and the picker, the form, the
// bounds check and the code pane all follow.
type CatalogEntry struct {
	ID     string            `json:"id"`
	Title  string            `json:"title"`
	Family string            `json:"family"`
	Blurb  string            `json:"blurb"`
	Tags   []string          `json:"tags,omitempty"`
	Inputs []algos.InputSpec `json:"inputs"`
}

// Catalog returns every registered algorithm, sorted for display.
//
// Here rather than in cmd/orrery for the same reason as Generate: the build
// writes it to algorithms.json and the server serves it from /api/algorithms.
// If those two ever disagree, the picker offers an algorithm the server will
// reject, or hides one it would accept -- and the bug presents as a missing
// entry rather than as a mismatch.
func Catalog() []CatalogEntry {
	specs := algos.All()
	out := make([]CatalogEntry, 0, len(specs))
	for _, s := range specs {
		out = append(out, CatalogEntry{
			ID: s.ID, Title: s.Title, Family: s.Family,
			Blurb: s.Blurb, Tags: s.Tags, Inputs: s.Inputs,
		})
	}
	return out
}
