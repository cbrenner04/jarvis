## Verdict: required refinements before implementation

### 1. Pin wait completion semantics (invocation boundary vs lifecycle terminal)

The draft binds the immediate path to `isTerminalRunStatus` (includes resumable `paused`/`killed`) while intent language reads as lifecycle completion (`completed`/`blocked`/`failed`). These produce different operator contracts for pause, kill, and budget-soft-stop.

**Required:** One explicit decision row choosing invocation-boundary (resolve at each `loop_finished` quiescent edge, including resumable stops) or lifecycle-completion (block until non-resumable terminal). Name the predicate used for immediate vs blocking paths; do not reference private `isTerminalRunStatus` as normative unless exported or duplicated in the spec.

**Rationale:** AC1/AC2 and intent “terminal boundary” are ambiguous without this; implementers will ship incompatible behavior.

---

### 2. Pin blocking-path subscription cursor

`follow` replays persisted events from seq 1 before live appends. A resumed in-progress run already has prior `loop_finished` rows while durable status is non-lifecycle-terminal. Blocking on bare `follow` until first terminal signal resolves on replay, not the next boundary.

**Required:** Decision pinning how blocking waits distinguish historical terminal signals from the subscription edge (e.g. subscribe cursor at `tail` last seq, resolve only on terminal signal with `seq > subscribeSeq`). Immediate path must remain “last terminal signal in log” (not the subscribe cursor).

**Rationale:** Without this, resumed-run and concurrent-waiter ACs are falsifiable by a literal `follow` implementation.

---

### 3. Close `budget-soft-stopped` posture

`budget-soft-stopped` has `loop_finished` but is absent from `isTerminalRunStatus`. Immediate vs blocking behavior is undefined.

**Required:** Tie to the completion-semantics choice in (1): immediate resolve from last `loop_finished` or block until next boundary. At least one AC if invocation-boundary wins.

---

### 4. Pin long-running RPC IPC contract

The spec requires holding the request open until resolve or disconnect; current IPC writes the response synchronously on handler return.

**Required:** One decision naming the wire pattern (e.g. deferred response on same request `id`, or stream-shaped wait). One behavioral AC proving a client can have pending `wait`(s) on one connection while other RPCs proceed (if that pattern is chosen).

**Rationale:** Task checklist flags async dispatch but leaves mechanism open; structure is the contract here.

---

### 5. Close unknown-`runId` deferral

Intent defers unknown-`runId` posture; sibling run-control verbs reject via `loadRun` → `unknown_run`. Raw `follow` on a missing run replays empty and blocks indefinitely. Tail gates with `loadRun` before `follow`.

**Required:** Pin `unknown_run` (or equivalent explicit error) with `loadRun` gate before any blocking `follow`; remove the deferral. One AC.

**Rationale:** Unpinned posture invites a hanging RPC; intent already requires matching tail no-hang invariant.

---

### 6. Pin response wire shape

Docs updates name homes but not the result contract.

**Required:** Flat `result` field list in `daemon-host.md` RPC table (and cross-link in architecture doc per intent): which fields are always present, which are omitted when no `loop_finished` exists (`run_execution_failed`, kill-before-log, skew cases).

---

### 7. Extend acceptance criteria for pinned semantics

Add ACs only as consequences of decisions above:

| Gap | When required |
| --- | --- |
| Resumed in-progress wait blocks until **next** terminal edge, not replay | Always (follows #2) |
| Pause / kill / budget-soft-stop immediate resolve shapes | If invocation-boundary (#1) |
| `invalid_params` for missing `runId` | Always (sibling verb parity) |
| Disconnect: detached waiter sends no RPC response | Always |
| Kill race / durable terminal row without persisted loop fields | One AC or decision line (parallel to `run_execution_failed` AC) |
| Fan-out registry removed after all waiters resolve or detach | One decision line |

Preservation ACs citing existing tests are adequate; no change needed.

---

### 8. Minor spec hygiene (non-blocking if above land)

- Copy intent prerequisites into subspec if implementers need the gate.
- Clarify abort semantics as socket disconnect or in-process abort on the waiter’s `follow` subscription — not a wire-level `AbortSignal` param unless IPC adds one.

---

### Upheld without refinement

Additive scope, payload composition (`loop_finished` fields + durable `runStatus`), concurrent fan-out, per-waiter disconnect isolation, `run_execution_failed` path, preservation test citations, `daemon-host.md` table expansion, omission of `v1-behaviors.md` (net-new v2 RPC), single-subspec scope if IPC + fan-out ship together.
