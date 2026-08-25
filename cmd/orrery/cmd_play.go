package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/sanu1001/orrery/internal/replay"
	"github.com/sanu1001/orrery/internal/trace"
)

// cmdPlay is the terminal player.
//
// It exists to prove a claim rather than to be pretty: the browser and this
// share ZERO rendering code, and both are complete consumers of the same trace.
// If a change to the format breaks one and not the other, the format is
// underspecified.
//
// Input is line-based (Enter to step) rather than raw-mode arrow keys, because
// raw mode needs golang.org/x/term and the dependency is not worth it for a
// debugging tool. Upgrading is ~20 lines if it ever matters.
func cmdPlay(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: orrery play FILE")
	}
	t, err := load(args[0])
	if err != nil {
		return err
	}
	p, err := replay.New(t, 1)
	if err != nil {
		return err
	}

	fmt.Printf("\n%s -- %d steps\n", t.Meta.Title, p.Steps())
	fmt.Println("[enter] next   b back   <n> seek   e end   0 start   q quit")

	in := bufio.NewScanner(os.Stdin)
	for {
		render(p, t)
		fmt.Printf("\nstep %d/%d > ", p.Step(), p.Steps())
		if !in.Scan() {
			fmt.Println()
			return nil
		}
		cmd := strings.TrimSpace(in.Text())
		switch {
		case cmd == "q":
			return nil
		case cmd == "":
			if !p.Next() {
				fmt.Println("(end of trace)")
			}
		case cmd == "b":
			if !p.Prev() {
				fmt.Println("(start of trace)")
			}
		case cmd == "e":
			p.Seek(p.Steps())
		case cmd == "0":
			p.Seek(0)
		default:
			if n, err := strconv.Atoi(cmd); err == nil {
				if err := p.Seek(n); err != nil {
					fmt.Println(err)
				}
			}
		}
	}
}

func render(p *replay.Player, t *trace.Trace) {
	fmt.Print("\n")
	st := p.State()
	changed := map[string]bool{}
	for _, k := range p.Changed() {
		changed[k] = true
	}

	for _, name := range st.Names() {
		s := st.Structs[name]
		switch s.Kind {
		case trace.KindGrid:
			renderGrid(name, s, changed)
		case trace.KindArray:
			renderArray(name, s, changed)
		case trace.KindScalar:
			fmt.Printf("  %-8s %s\n", name, trace.Canon(s.Get(trace.Path{})))
		case trace.KindMap:
			renderMap(name, s, changed)
		default:
			fmt.Printf("  %-8s (%s, %d slots)\n", name, s.Kind, len(s.Root()))
		}
	}

	if frames := p.Stack(); len(frames) > 0 {
		fmt.Print("\n  stack: ")
		for i, f := range frames {
			if i > 0 {
				fmt.Print(" > ")
			}
			fmt.Print(callLabel(f))
		}
		fmt.Println()
	}

	// The explanation is generated from expr + deps by the same rules the web
	// app uses. No algorithm-specific text exists anywhere.
	for _, e := range p.CurrentEvents() {
		if line := explain(e, t); line != "" {
			fmt.Printf("\n  %s\n", line)
		}
		if e.Ln > 0 && t.Meta.Source != nil {
			if src := sourceLine(t.Meta.Source, e.Ln); src != "" {
				fmt.Printf("  %4d | %s\n", e.Ln, src)
			}
		}
	}
}

func renderGrid(name string, s *trace.Struct, changed map[string]bool) {
	if len(s.Dims) != 2 {
		return
	}
	rows, cols := s.Dims[0], s.Dims[1]
	fmt.Printf("  %s\n", name)
	for r := 0; r < rows; r++ {
		fmt.Print("    ")
		for c := 0; c < cols; c++ {
			at := trace.Path{trace.Idx(r), trace.Idx(c)}
			cell := fmtCell(s.Get(at))
			if changed[at.KeyWith(name)] {
				fmt.Printf("[%4s]", cell)
			} else {
				fmt.Printf(" %4s ", cell)
			}
		}
		fmt.Println()
	}
}

func renderArray(name string, s *trace.Struct, changed map[string]bool) {
	if len(s.Dims) != 1 {
		return
	}
	fmt.Printf("  %-8s", name)
	for i := 0; i < s.Dims[0]; i++ {
		at := trace.Path{trace.Idx(i)}
		cell := fmtCell(s.Get(at))
		if changed[at.KeyWith(name)] {
			fmt.Printf("[%4s]", cell)
		} else {
			fmt.Printf(" %4s ", cell)
		}
	}
	fmt.Println()
}

func renderMap(name string, s *trace.Struct, changed map[string]bool) {
	flat := s.Flat()
	if len(flat) == 0 {
		fmt.Printf("  %-8s (empty)\n", name)
		return
	}
	keys := make([]string, 0, len(flat))
	for k := range flat {
		keys = append(keys, k)
	}
	sortKeys(keys)
	fmt.Printf("  %-8s", name)
	for _, k := range keys {
		mark := " "
		if changed[name+" "+k] {
			mark = "*"
		}
		fmt.Printf(" %s%s=%s", mark, k, fmtCell(flat[k]))
	}
	fmt.Println()
}

// sortKeys sorts numerically when every key is an integer, so 2 comes before
// 10. A plain lexicographic sort makes a memo table read wrong.
func sortKeys(keys []string) {
	allNum := true
	for _, k := range keys {
		if _, err := strconv.Atoi(k); err != nil {
			allNum = false
			break
		}
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && less(keys[j], keys[j-1], allNum); j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
}

func less(a, b string, numeric bool) bool {
	if numeric {
		x, _ := strconv.Atoi(a)
		y, _ := strconv.Atoi(b)
		return x < y
	}
	return a < b
}

func fmtCell(v trace.Value) string {
	if v == nil {
		return "."
	}
	if s, ok := v.(string); ok && s == trace.Inf {
		return "inf"
	}
	return trace.Canon(v)
}

func callLabel(e trace.Event) string {
	var b strings.Builder
	b.WriteString(e.Fn)
	b.WriteByte('(')
	for i, a := range e.Args {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "%s=%s", a.N, trace.Canon(a.V))
	}
	b.WriteByte(')')
	return b.String()
}

func sourceLine(src *trace.Source, ln int) string {
	lines := strings.Split(src.Text, "\n")
	i := ln - src.FirstLine
	if i < 0 || i >= len(lines) {
		return ""
	}
	return strings.TrimRight(lines[i], " \t")
}
