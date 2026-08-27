// Package heaps holds the array-backed tree structures: the binary heap and
// the segment tree.
//
// NEITHER GETS A `nodes` STRUCTURE, and that refusal is the point of the pair.
// Both are arrays. Giving them node identity would put a topology in the trace
// that the algorithm never writes, and the renderer would then be drawing a
// claim rather than the data. What they declare instead is `alsoAs: "tree"`, a
// second READING of the same cells with children at 2i+1 and 2i+2 --
// arithmetic on an index, no different in kind from a grid's [r, c].
//
// RENDERERS/TREE.md 5 and RENDERERS/LINEAR.md 5.1.
package heaps

import "strconv"

func itoa(n int) string { return strconv.Itoa(n) }
