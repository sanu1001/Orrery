// @ts-check
/**
 * Graph topology: what the nodes and edges ARE, before anything decides where
 * they go.
 *
 * Split from graphLayout.js exactly the way treeShape.js is split from
 * tidyTree.js. "An edge is a pair of node ids with an attribute record" is one
 * statement; "here is where to draw it" is four different ones chosen by
 * provenance. Keeping them apart is what lets the four strategies be tested
 * against a fixed graph with no React in the way.
 */

/**
 * Stable orientation for an undirected edge, so that a|b and b|a address the
 * same attribute record.
 *
 * CRITICAL: must match trace.OrientEdge in internal/trace/path.go. The Go
 * tracer writes every edge attribute at the oriented key and this reads them
 * back; disagreeing does not fail loudly, it renders every weight blank.
 *
 * @param {string} u @param {string} v @param {boolean} directed
 * @returns {[string, string]}
 */
export function orientEdge(u, v, directed) {
  return !directed && v < u ? [v, u] : [u, v];
}

/** The `$edges` path segment for one edge. Must match trace.EdgeKey. */
export function edgeKey(u, v) {
  return u + '|' + v;
}

/**
 * @typedef {object} GEdge
 * @property {string} u
 * @property {string} v
 * @property {string} key    the oriented `$edges` segment
 * @property {*} w           the DECLARED weight; current state may have relaxed it
 * @property {boolean} loop  u === v
 * @property {number} lane   perpendicular offset slot among parallel edges
 */

/**
 * @typedef {object} Graph
 * @property {string[]} nodes         declaration order -- every layout tie-breaks on it
 * @property {GEdge[]} edges
 * @property {boolean} directed
 * @property {boolean} weighted
 * @property {string} hint            declared layoutHint, "" when absent
 * @property {Map<string, string[]>} adj  out-neighbours (both ways when undirected)
 * @property {Map<string, number>} deg    total incident edges, self-loops counted once
 */

/**
 * Read a graph out of a structUnion entry.
 *
 * Two provenances, one result. A `kind:"graph"` structure declares its nodes
 * and edges in the schema, which is what lets layout run before the first
 * frame. A `kind:"nodes"` structure with pointer fields grows its edges as the
 * run proceeds, so they arrive through the union's ptr triples instead -- but
 * the union is still complete before frame one, so layout is still a batch
 * problem and nothing has to move. RENDERERS/00-OVERVIEW.md 2.
 *
 * @param {*} union structUnion entry
 * @returns {Graph}
 */
export function buildGraph(union) {
  const schema = union?.schema ?? null;
  const directed = !!schema?.directed;
  const nodes = [...(schema?.nodes ?? [])];
  const index = new Map(nodes.map((id, i) => [id, i]));
  const add = (id) => {
    if (typeof id !== 'string' || id === '' || index.has(id)) return;
    index.set(id, nodes.length);
    nodes.push(id);
  };

  /** @type {GEdge[]} */
  const edges = [];
  const push = (u, v, w) => {
    if (typeof u !== 'string' || typeof v !== 'string' || !u || !v) return;
    add(u); add(v);
    const [a, b] = orientEdge(u, v, directed);
    edges.push({ u, v, key: edgeKey(a, b), w: w ?? null, loop: u === v, lane: 0 });
  };

  for (const e of schema?.edges ?? []) push(e?.u, e?.v, e?.w);
  // Ptr-derived edges. The field name is dropped: a graph draws a line between
  // two nodes, and which pointer field made it is a tree/list question.
  for (const t of union?.edges ?? []) {
    if (Array.isArray(t) && t.length === 3) push(String(t[0]), String(t[2]), null);
  }
  for (const id of union?.nodeIds ?? []) add(String(id));

  assignLanes(edges);

  const adj = new Map(nodes.map((id) => [id, /** @type {string[]} */([])]));
  const deg = new Map(nodes.map((id) => [id, 0]));
  for (const e of edges) {
    if (e.loop) { deg.set(e.u, (deg.get(e.u) ?? 0) + 1); continue; }
    adj.get(e.u)?.push(e.v);
    if (!directed) adj.get(e.v)?.push(e.u);
    deg.set(e.u, (deg.get(e.u) ?? 0) + 1);
    deg.set(e.v, (deg.get(e.v) ?? 0) + 1);
  }

  return {
    nodes, edges, directed,
    weighted: !!schema?.weighted,
    hint: schema?.layoutHint ?? '',
    adj, deg,
  };
}

/**
 * Spread parallel edges across perpendicular slots so they do not draw on top
 * of each other.
 *
 * Grouped by the UNORDERED pair even in a directed graph, because a->b and b->a
 * are the pair that actually overlaps -- they are two distinct edges that share
 * one line. Lanes are symmetric about zero so a lone edge is never offset.
 */
function assignLanes(edges) {
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  edges.forEach((e, i) => {
    const [a, b] = orientEdge(e.u, e.v, false);
    const k = edgeKey(a, b);
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  });
  for (const idxs of groups.values()) {
    if (idxs.length === 1) continue;
    idxs.forEach((i, n) => { edges[i].lane = n - (idxs.length - 1) / 2; });
  }
}

/**
 * The neighbourhood at full strength: the cursor node and everything it points
 * at. RENDERERS/GRAPH.md 2.
 *
 * Out-neighbours only when directed, because a Dijkstra step relaxes the edges
 * LEAVING u -- lighting up the ones arriving would show work that is not
 * happening.
 *
 * @param {Graph} g @param {string|null} u
 * @returns {{nodes: Set<string>, edges: Set<number>}}
 */
export function neighbourhood(g, u) {
  const nodes = new Set();
  const edges = new Set();
  if (!u) return { nodes, edges };
  nodes.add(u);
  for (const v of g.adj.get(u) ?? []) nodes.add(v);
  g.edges.forEach((e, i) => {
    if (e.u === u || (!g.directed && e.v === u)) edges.add(i);
  });
  return { nodes, edges };
}

/**
 * Connected components, in declaration order, over the UNDIRECTED reading of
 * the edge set -- two nodes joined by a one-way edge are still one picture.
 *
 * Iterative, like every other walk in this codebase: a 40-node path graph is a
 * 40-deep recursion and there is no reason to find out where the limit is.
 *
 * @param {Graph} g @returns {string[][]}
 */
export function components(g) {
  /** @type {Map<string, string[]>} */
  const undirected = new Map(g.nodes.map((id) => [id, []]));
  for (const e of g.edges) {
    if (e.loop) continue;
    undirected.get(e.u)?.push(e.v);
    undirected.get(e.v)?.push(e.u);
  }
  const seen = new Set();
  const out = [];
  for (const start of g.nodes) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = /** @type {string} */(stack.pop());
      comp.push(id);
      for (const n of undirected.get(id) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    // Declaration order inside the component too, so the picture does not
    // depend on which end of an edge list the walk happened to start from.
    comp.sort((a, b) => g.nodes.indexOf(a) - g.nodes.indexOf(b));
    out.push(comp);
  }
  return out;
}
