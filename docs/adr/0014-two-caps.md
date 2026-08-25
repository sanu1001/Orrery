# ADR 0014 — Two independent caps: events and wall clock

**Status:** accepted

## Context

A trace must be bounded. The obvious bound is event count.

## Decision

Three caps, enforced in two places:

| Cap | Default | Enforced by |
|---|---|---|
| events | 200,000 | the producer (Go tracer, or the WASM guest) |
| serialized bytes | 8 MiB | the producer, after encoding |
| **wall clock** | 5s built-in / 10s Stage B | **the host** — server context, or a Worker watchdog |

## Alternatives

**Event cap only.** Rejected, and this is the whole point of the ADR: an empty
infinite loop emits **zero events**. It sits under the event cap forever. The
guest can never catch it because the guest is the thing that is stuck. Only the
host can.

Missing this is the classic bug in this kind of system, and it presents as a
hung tab, which a user reads as "your site crashed."

**Wall clock only.** Rejected: a fast machine produces a 5-million-event trace
in 5 seconds, which is unrenderable and a 500MB payload.

**Byte cap only.** Rejected: it is the *right* bound for payload size but the
wrong one for user feedback — "your algorithm produced too much data" is less
useful than "your algorithm made 200,000 moves, which is what exponential looks
like."

**Instruction counting inside the guest.** Rejected: Go on WASM has no cheap
instruction counter, and a periodic time check inside the guest still cannot
help when the guest is stuck in a tight loop that never reaches the check.

## Consequences

- Truncation is a **teaching moment**, not an error: recording stops,
  `meta.truncated` is set, and the partial trace stays valid and playable.
- The wall-clock cap kills the Worker, which loses the partial trace. Mitigated:
  the guest posts a partial trace every 20k events; the host keeps the last one
  and offers it on watchdog fire, marked `truncatedReason: "wall"`.
- The deadline is checked every 1024 events, not every event — `time.Now()` is
  the expensive part.
- Input caps are a **separate** concern and are per-algorithm, because trace
  size is a function of complexity, not of input size. `FLAWS.md` §3.
