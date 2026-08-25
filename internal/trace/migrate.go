package trace

import "fmt"

// migration converts a trace document from version From to version From+1.
// Each one ships with a golden fixture at the old version, so migrations are
// themselves regression-tested. ADR 0019.
type migration struct {
	From int
	Fn   func(b []byte) ([]byte, error)
}

// ladder is applied in order. Empty at v1 -- there is nothing older yet.
var ladder = []migration{}

// Migrate walks a document up the version ladder to the current version.
func Migrate(b []byte, from int) (*Trace, error) {
	cur := from
	for cur < Version {
		var step *migration
		for i := range ladder {
			if ladder[i].From == cur {
				step = &ladder[i]
				break
			}
		}
		if step == nil {
			return nil, fmt.Errorf("trace: no migration from version %d", cur)
		}
		out, err := step.Fn(b)
		if err != nil {
			return nil, fmt.Errorf("trace: migration %d->%d failed: %w", cur, cur+1, err)
		}
		b, cur = out, cur+1
	}
	return Decode(b)
}
