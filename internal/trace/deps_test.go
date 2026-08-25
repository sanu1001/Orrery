package trace_test

import (
	"os/exec"
	"strings"
	"testing"
)

// TestTraceHasNoDependencies keeps internal/trace stdlib-only.
//
// Why bother: this package is the artifact another project would vendor if the
// format ever became a real thing. A package that pulls in a JSON library, a
// logger and a UUID generator is a package nobody vendors. Keeping it clean
// costs nothing and is a visible signal about the rest of the codebase.
func TestTraceHasNoDependencies(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", "github.com/sanu1001/orrery/internal/trace").Output()
	if err != nil {
		t.Skipf("go list unavailable: %v", err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" || strings.HasPrefix(line, "github.com/sanu1001/orrery") {
			continue
		}
		// A stdlib import path has no dot before its first slash.
		head := line
		if i := strings.Index(line, "/"); i >= 0 {
			head = line[:i]
		}
		if strings.Contains(head, ".") {
			t.Errorf("internal/trace must stay stdlib-only, but it imports %q", line)
		}
	}
}
