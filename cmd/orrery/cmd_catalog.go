package main

import (
	"encoding/json"
	"os"

	"github.com/sanu1001/orrery/internal/gen"
)

func cmdCatalog(args []string) error {
	b, err := json.MarshalIndent(gen.Catalog(), "", "  ")
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
