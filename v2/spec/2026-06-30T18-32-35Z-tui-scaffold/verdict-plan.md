## Verdict — required refinements

### Scope and intent alignment

- **`01` (or `index.md`) must record that this spec ships connect/liveness scaffold only** — launch, monitor, log tail, and steer remain sibling work. Phase 4 in `v2-build-order.md` describes aspirational end-state; without an explicit shipped-vs-deferred split, implementers and doc readers will treat this spec as Phase 4 dogfood.

### `00-tui-daemon-client.md`

- **Name the typed connection-error contract in Decisions** — what counts as transport/connect failure vs daemon `error` RPC frame, and how it relates to existing CLI patterns (`formatConnectionError`, named error classes). Implementers cannot satisfy “typed connection error” without a named surface.
- **Add acceptance criteria for checklist items currently untested:**
  - `health` and `status` on one connection (wire reuse).
  - Malformed or non-correlated RPC replies → typed connection error.
  - Connect succeeds but RPC returns `error` frame → distinct failure path (AC or explicit out-of-scope).
  - Injectable `connectIpcClient` seam exercised by co-located tests (cite test path or behavioral AC).
  - Socket-backed cases per `v2/docs/test-writing.md` (`canUseUnixSockets` / `test.skipIf`), not fakes-only.
- **Add AC for inline export doc-comments** per `v2/docs/documentation-standard.md` (internal slice still has a documentation contract).

### `01-tui-entry-connect.md`

- **Close the terminal UI library deferral before merge** — library named in Decisions and enforced by AC so production cannot ship a stdout-only shim while tests use a fake view host.
- **Pin scaffold session lifecycle and exit codes:**
  - Connected path: prove liveness, then exit `0` (or explicit wait-for-quit if the chosen library requires it — either way must be pinned).
  - Unavailable path: exit `1` (consistent with `write-behavior.md` daemon/run failure table).
- **Pin minimum connected operator contract** — view host must record evidence that both `health` and IPC `status` succeeded; exact copy/layout stays deferred.
- **Pin unavailable-daemon contract** — operator-visible message naming `~/.jarvis/daemon.sock` and `jarvis daemon start`; render channel may follow library choice.
- **Tighten forbidden IPC surface** — blanket “only `health` and `status`” (or extend forbidden list to include `shutdown`, `stream-open`, and other run-control/stream RPCs). Current partial list leaves gaps.
- **Add AC enforcing library pin** (Decisions updated before dependency lands).

### Documentation (`01` doc pass)

- **`v2/docs/write-behavior.md`** — `jarvis tui` row in the same command/output/exit table shape as daemon/run; production socket default; connected vs unavailable contract; cross-link daemon lifecycle commands.
- **`v2/docs/v2-architecture.md` Interface** — reconcile aspirational TUI paragraph (launch/monitor/steer) with shipped scaffold subsection; refresh stale “production defaults deferred to first consumer” lifecycle bullet now that CLI (and soon TUI client) pin paths.
- **`v2/docs/daemon-host.md`** — cross-link TUI client / `jarvis tui` as a socket-default consumer (consumer-layer default, not transport-layer default).
- **Connected-state docs must distinguish IPC `status` from `jarvis daemon status`** — prevents operator confusion when scaffold shows raw IPC liveness.

### Rationale (why these block merge)

Intent scopes connect + liveness only; gaps above let an implementer pass ACs with stdout shims, ambiguous session/exit behavior, incomplete failure coverage, or docs that contradict shipped reality. Spec guidance requires behavioral ACs tied to observable contracts and durable-doc alignment in the same subspec when operator semantics change — several items are checklist-only or deferred without AC enforcement today.

### Not required for merge (accepted as-is)

- `00`/`01` subspec split and no `cli.ts` refactor in `00`.
- Third RPC-client layer duplication until a follow-up consolidation intent.
- Homedir expansion AC (follows existing CLI pattern).
- `close()` cleanup AC unless leak risk is demonstrated.
- Non-TTY behavior — defer to first real library consumer unless library choice forces a decision now.
- `v2-build-order.md` edit — sufficient if architecture/write-behavior reconciliation makes scaffold vs aspirational split obvious.
