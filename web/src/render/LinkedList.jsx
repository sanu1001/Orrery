// @ts-check
import { memo, useMemo } from 'react';
import { addrKey, fmtValue } from '../lib/value.js';
import { currentEdges } from './layout/treeShape.js';
import { chainOrder, reachable, serpentine } from './layout/serpentine.js';
import { useReadSet } from './Linear.jsx';
import { resolveFocus } from './focus.js';

const VIEW_W = 720;
const PAD = 26;
// Two sizes, not a continuous scale. Past forty nodes the boxes shrink once and
// values below 24px stop being drawn; a smooth ramp would make every list a
// slightly different size and nothing would be comparable to anything else.
const BIG = { w: 56, h: 40, gap: 28, rowGap: 46 };
const SMALL = { w: 40, h: 32, gap: 20, rowGap: 38 };
const SHRINK_ABOVE = 40;

/**
 * Singly and doubly linked lists, and the cycle algorithms that live on them.
 *
 * A separate renderer from the tree on purpose: a list IS a tree of branching
 * factor one, so tidy-tree layout would run and would draw a vertical column.
 * Lists read left to right. What the two share is the layer underneath —
 * topology comes from `treeShape.js`, because "an edge is a pointer field
 * holding a ref" is the same statement whatever shape it makes.
 *
 * `next` draws ABOVE the row and `prev` BELOW. Both on one line turns a doubly
 * linked list into a ladder nobody can read. RENDERERS/LINKED_LIST.md 4.
 */
export default function LinkedList({ store, spec, version, focus, onFocus, onPin }) {
  const s = store.struct(spec.s);
  const union = store.index.structUnion.get(spec.s);

  const schema = s?.schema ?? union?.schema ?? null;
  const fields = useMemo(() => ptrFields(schema), [schema]);
  const labelField = schema?.label ?? 'val';
  const settledField = spec.options?.settled ?? null;
  const chain = fields[0] ?? 'next';
  const backField = fields.find((f) => f !== chain) ?? null;

  const order = useMemo(
    () => chainOrder(union, fields, spec.options?.reflow),
    [union, fields, spec.options?.reflow],
  );

  const box = order.length > SHRINK_ABOVE ? SMALL : BIG;
  const perRow = Math.max(3, Math.floor((VIEW_W - PAD * 2) / (box.w + box.gap)));
  const pos = useMemo(() => serpentine(order, perRow), [order, perRow]);

  const now = useMemo(
    // store.version, not `s`: the Struct is mutated in place, so its identity
    // never changes and depending on it alone would never re-run.
    () => currentEdges(s, fields), [s, fields, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const refs = s ? s.refs() : {};
  const live = useMemo(
    () => reachable(s, [chain], refs), [s, chain, JSON.stringify(refs), version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const changed = store.changed();
  const reads = useReadSet(store);
  const lit = resolveFocus(store, focus);
  const refAt = useMemo(() => invertRefs(refs), [JSON.stringify(refs)]);

  const xy = (id) => {
    const p = pos.get(id);
    if (!p) return null;
    return {
      x: PAD + p.col * (box.w + box.gap) + box.w / 2,
      y: PAD + p.row * (box.h + box.rowGap) + box.h / 2,
      ...p,
    };
  };

  const rows = order.length === 0 ? 1 : Math.ceil(order.length / perRow);
  const height = PAD * 2 + rows * (box.h + box.rowGap);

  if (!s) return <div className="pane-note">not created yet</div>;
  const present = order.filter((id) => s.exists(id));
  if (present.length === 0) return <div className="pane-note">empty list</div>;

  const next = [], back = [];
  for (const [k, to] of now) {
    const [from, field] = k.split('|');
    if (!s.exists(from)) continue;
    (field === chain ? next : back).push({ from, field, to });
  }

  return (
    <svg className="llist" viewBox={`0 0 ${VIEW_W} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="ll-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" />
        </marker>
      </defs>

      {/* prev edges UNDER the boxes so their arrowheads never hide behind one. */}
      <g className="ll-prev">
        {backField && back.map((e, i) => (
          <Edge key={`p${i}`} a={xy(e.from)} b={xy(e.to)} box={box} below
                missing={!s.exists(e.to)} />
        ))}
      </g>

      {order.map((id) => {
        if (!s.exists(id)) return null;
        const p = xy(id);
        const key = addrKey(spec.s, [id]);
        const vkey = addrKey(spec.s, [id, labelField]);
        return (
          <LNode key={id} id={id} s={spec.s} x={p.x} y={p.y} box={box}
                 v={order.length > SHRINK_ABOVE && box.w < 48 ? '' : fmtValue(s.get([id, labelField]))}
                 w={changed.has(key) || changed.has(vkey)}
                 rd={reads.has(vkey) || reads.has(key)}
                 settled={!!settledField && !!s.get([id, settledField])}
                 orphan={!live.has(id)}
                 linked={lit.cells.has(key) || lit.cells.has(vkey)}
                 onFocus={onFocus} onPin={onPin} />
        );
      })}

      {/* next edges OVER the boxes. */}
      <g className="ll-next">
        {next.map((e, i) => (
          <Edge key={`n${i}`} a={xy(e.from)} b={xy(e.to)} box={box}
                missing={!s.exists(e.to)} />
        ))}
        {/* A terminator, drawn as a ground symbol rather than the word "null":
            the end of the list is a fact about the picture, not a value. */}
        {order.map((id) => {
          if (!s.exists(id) || now.has(`${id}|${chain}`)) return null;
          const p = xy(id);
          return <Ground key={`g${id}`} x={p.x + box.w / 2 + 12} y={p.y} />;
        })}
      </g>

      {Object.entries(groupRefs(refs)).map(([id, names]) => {
        if (!s.exists(id)) return null;
        const p = xy(id);
        return names.map((name, i) => (
          // Chips STACK rather than overlap, which is what makes Floyd's
          // meeting point readable: slow and fast land on one node and you can
          // still see that there are two of them.
          <text key={`${id}-${name}`} className="ll-chip"
                x={p.x} y={p.y - box.h / 2 - 8 - i * 12}>{name}</text>
        ));
      })}
    </svg>
  );
}

const LNode = memo(function LNode({ id, s, x, y, box, v, w, rd, settled, orphan, linked, onFocus, onPin }) {
  return (
    <g className="lnode enter" data-w={w ? 1 : 0} data-r={rd ? 1 : 0}
       data-settled={settled ? 1 : 0} data-orphan={orphan ? 1 : 0}
       data-linked={linked ? 1 : 0} data-anchor={addrKey(s, [id])}
       transform={`translate(${x} ${y})`}
       onMouseEnter={() => onFocus?.({ kind: 'cell', s, at: [id] })}
       onMouseLeave={(e) => {
         if (document.activeElement !== e.currentTarget) onFocus?.(null);
       }}
       onClick={() => onPin?.({ kind: 'cell', s, at: [id] })}>
      <rect x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} rx="4" />
      {v !== '' && <text y={4}>{v}</text>}
      {orphan && <text className="ll-orphan" y={box.h / 2 + 11}>unreachable</text>}
    </g>
  );
}, (a, b) => a.v === b.v && a.w === b.w && a.rd === b.rd && a.settled === b.settled &&
             a.orphan === b.orphan && a.linked === b.linked && a.x === b.x && a.y === b.y);

/**
 * One edge, routed by how far it travels.
 *
 * Adjacent boxes get a straight arrow. Anything longer arcs, because a straight
 * line between non-neighbours passes through every box in between and reads as
 * pointing at all of them.
 */
function Edge({ a, b, box, below, missing }) {
  if (!a) return null;
  const cls = `ll-edge${below ? ' below' : ''}${missing ? ' missing' : ''}`;

  if (!b || missing) {
    // A pointer at a node that is gone gets a stub and a marker: "this ref
    // dangles" is information, an absent arrow is not.
    const dir = below ? -1 : 1;
    const x = a.x + (box.w / 2 + 22) * dir;
    return (
      <g>
        <line className={cls} x1={a.x + (box.w / 2) * dir} y1={a.y} x2={x} y2={a.y}
              markerEnd="url(#ll-arrow)" />
        <circle className="ll-stub" cx={x + 9 * dir} cy={a.y} r={7} />
        <text className="ll-stub-t" x={x + 9 * dir} y={a.y + 3}>?</text>
      </g>
    );
  }

  const side = below ? 1 : -1;
  const edge = box.h / 2;

  if (a.i === b.i) {
    // Self-loop: a small circle above its own box.
    const r = 14;
    return <path className={cls} fill="none" markerEnd="url(#ll-arrow)"
                 d={`M ${a.x - 8} ${a.y + side * edge} A ${r} ${r} 0 1 ${below ? 0 : 1} ${a.x + 8} ${a.y + side * edge}`} />;
  }

  const adjacent = a.row === b.row && Math.abs(a.col - b.col) === 1;
  if (adjacent && !below) {
    const dir = Math.sign(b.x - a.x);
    return <line className={cls} markerEnd="url(#ll-arrow)"
                 x1={a.x + (box.w / 2) * dir} y1={a.y} x2={b.x - (box.w / 2) * dir} y2={b.y} />;
  }

  // Everything else arcs clear of whatever sits between the two ends.
  const lift = a.row === b.row
    ? Math.min(46, 14 + Math.abs(a.col - b.col) * 7)
    : 26 + Math.abs(a.row - b.row) * 10;
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) + side * (edge + lift);
  return <path className={cls} fill="none" markerEnd="url(#ll-arrow)"
               d={`M ${a.x} ${a.y + side * edge} Q ${mx} ${my} ${b.x} ${b.y + side * edge}`} />;
}

/** The end of the list: a ground symbol, not the word "null". */
function Ground({ x, y }) {
  return (
    <g className="ll-ground">
      <line x1={x - 10} y1={y} x2={x} y2={y} />
      <line x1={x} y1={y - 7} x2={x} y2={y + 7} />
      <line x1={x + 3} y1={y - 4} x2={x + 3} y2={y + 4} />
      <line x1={x + 6} y1={y - 2} x2={x + 6} y2={y + 2} />
    </g>
  );
}

function ptrFields(schema) {
  const all = Object.entries(schema?.fields ?? {})
    .filter(([, k]) => k === 'ptr').map(([f]) => f);
  const order = (schema?.order ?? []).filter((f) => all.includes(f));
  return [...order, ...all.filter((f) => !order.includes(f))];
}

function groupRefs(refs) {
  const out = {};
  for (const [name, id] of Object.entries(refs ?? {})) {
    if (!id) continue;
    (out[id] ??= []).push(name);
  }
  return out;
}

function invertRefs(refs) {
  const out = new Map();
  for (const [name, id] of Object.entries(refs ?? {})) if (id) out.set(id, name);
  return out;
}
