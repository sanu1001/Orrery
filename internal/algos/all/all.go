// Package all blank-imports every algorithm package so their init() functions
// register with the algos registry.
//
// It exists as a separate package to break an import cycle: the algorithm
// packages import algos (for Register and Spec), so algos itself cannot import
// them back. Anything that wants the full catalogue -- the CLI, the server --
// imports this.
package all

import (
	_ "github.com/sanu1001/orrery/internal/algos/backtracking"
	_ "github.com/sanu1001/orrery/internal/algos/dp"
	_ "github.com/sanu1001/orrery/internal/algos/searching"
	_ "github.com/sanu1001/orrery/internal/algos/sorting"
	_ "github.com/sanu1001/orrery/internal/algos/trees"
)
