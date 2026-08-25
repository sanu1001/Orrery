package main

import (
	"encoding/json"
	"os"

	"github.com/sanu1001/orrery/internal/algos"
)

// CatalogEntry is what the picker and the generated input form consume.
//
// It is derived entirely from Spec, which is why adding a thirteenth algorithm
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

func cmdCatalog(args []string) error {
	b, err := json.MarshalIndent(Catalog(), "", "  ")
	if err != nil {
		return err
	}
	out := ""
	for i := 0; i < len(args); i++ {
		if args[i] == "-o" && i+1 < len(args) {
			out = args[i+1]
		}
	}
	if out == "" {
		_, err = os.Stdout.Write(append(b, '\n'))
		return err
	}
	return os.WriteFile(out, append(b, '\n'), 0o644)
}
