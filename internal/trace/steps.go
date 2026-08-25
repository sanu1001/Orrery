package trace

// Step is a half-open range of events, [E0, E1).
//
// A STEP is what one press of the play button advances. An EVENT is one write.
// They are not 1:1 and conflating them is the most common bug in this design:
// adjacent events sharing a non-zero group id form ONE step, so a swap is two
// writes and one step. ADR 0020.
type Step struct {
	E0 int `json:"e0"`
	E1 int `json:"e1"`
	Ln int `json:"ln"` // source line of the first event in the range
}

// BuildSteps indexes events into steps, keeping only events with Lvl <= level.
//
// Filtering by level is sound ONLY because Lvl > 0 is restricted to structures
// declared Aux, and an Aux structure may never appear in any Deps -- so nothing
// a non-aux value depends on can be filtered away. Validator check V8 enforces
// the restriction; ADR 0016 has the proof.
func BuildSteps(events []Event, level int) []Step {
	var steps []Step
	i := 0
	for i < len(events) {
		if events[i].Lvl > level {
			i++
			continue
		}
		g := events[i].G
		j := i + 1
		if g != 0 {
			for j < len(events) && events[j].G == g {
				j++
			}
		}
		steps = append(steps, Step{E0: i, E1: j, Ln: events[i].Ln})
		i = j
	}
	return steps
}

// StepIndexOf returns the step containing event index ev, or -1.
func StepIndexOf(steps []Step, ev int) int {
	lo, hi := 0, len(steps)-1
	for lo <= hi {
		mid := (lo + hi) / 2
		switch {
		case ev < steps[mid].E0:
			hi = mid - 1
		case ev >= steps[mid].E1:
			lo = mid + 1
		default:
			return mid
		}
	}
	return -1
}
