# ADR 0013 — Compile on the server, execute in the browser

**Status:** accepted

## Context

Stage B lets a user paste Go and watch it run. That is arbitrary code execution
by definition. The question is *whose* machine it runs on.

## Decision

The server **parses, type-checks, rewrites and compiles** user code to
`GOOS=js GOARCH=wasm`. The artifact is executed **in the user's own browser**,
inside a Web Worker with no DOM access.

## Alternatives

**Execute on the server in a sandbox** (gVisor, Firecracker, seccomp+namespaces,
a language-level interpreter). Rejected: it is the hardest problem in the
project by a wide margin, it is a full-time specialty, and getting it 95% right
is indistinguishable from getting it wrong. It would also dominate the schedule
and add a class of operational risk a portfolio project should not carry.

**Interpret the user's code in the browser with a JS-hosted Go interpreter.**
Rejected: an interpreter for a real language subset is a larger project than
everything else here combined, and subtle semantic differences would make the
visualization untrustworthy.

**Do not support user code at all.** A legitimate option, and it is what Tier 1
does. Stage B exists because "paste your LeetCode solution and watch it" is the
feature that makes this more than a gallery.

## Consequences

- **The entire class of runtime sandbox escape is removed.** No seccomp policy,
  no syscall filtering, no side channels from executing attacker code. That is a
  large, real win and it is the correct claim to make.
- **It does not remove the risk of *compiling* untrusted code.** `//go:embed`
  reads server files into the artifact; cgo passes attacker-influenced flags to
  the linker; module fetching runs third-party build logic; compiler bombs
  exhaust memory. Enumerated in `STAGE_B.md` §7. Volunteer this before an
  interviewer finds it — see `FLAWS.md` §13.
- Mitigations are layered: an AST allowlist gate before anything else, then a
  container with no network, a read-only rootfs, 512MB, 1 CPU, 30s.
- The compile worker runs as a **separate image** from the API server, so no Go
  toolchain exists in the process serving public HTTP.
- **Shares carry the trace, not the binary** — distributing a stranger's
  compiled code to other users is not a thing to do casually. Deliberate
  exception to ADR 0007.
- Cost to the user: a ~600KB gzipped WASM download and a 2-6s compile.
