## Verdict — required refinements

### `01-tui-log-follow-view.md` — session lifecycle (blocks merge)

- **Resolve the post-replay completion conflict.** Shipped daemon tail uses `follow`, which replays then blocks until abort; the server does not emit `stream-end` for a known run merely because replay finished. The decision “session runs until tail ends or operator quit — no auto-exit after replay while live” contradicts the AC “tail completes after replay with no further frames → exit `0`” if read as production UX. Split acceptance criteria: (a) injectable fake/server-close path ends session `0`; (b) production quiescent/live run replays then idles until operator quit or client shutdown — rules out auto-exit via `list`/`wait`. *Rationale: intent requires follow-through streaming; behavioral ACs must not encode a contract the server cannot emit.*

- **Pin quiescent-run operator contract explicitly.** Record that after replay the session stays open for live appends and operator quit even when the run is no longer appending. *Rationale: architecture documents `follow` blocking semantics; without this, implementers may treat replay completion as session end.*

- **Pin operator quit as a testable seam.** Decision requires quit; production keybinding is deferred. Add decision + AC: injectable quit yields exit `0` and tail client shutdown (`stream-end`/abort). Record Ctrl-C/SIGINT handling or defer production binding only with an explicit first-consumer pin. *Rationale: without quit coverage, the only exit path for live tails is unspecified process signal behavior.*

- **Decide mid-session disconnect.** Pre-connect unreachable daemon is pinned (`1` + remediation copy). Mid-follow connection loss and error-payload `stream-end` (server emits `{ error }` on handler failure) are unset. Pin for both subspecs: client completion vs `TuiDaemonConnectionError`, operator feedback, exit code, and whether the view sends `stream-end` on disconnect. Deliberate divergence from `jarvis run log` (connection closed → `0`) is acceptable if recorded. *Rationale: spec guidance requires observable behavioral contracts; silent drift across TUI/CLI surfaces is costly to reverse.*

- **Pin ink session teardown.** Record that view unmount/quit/abort must propagate to the 00 tail client so `stream-end` is sent and follow aborts. *Rationale: blocking follow + ink render loop leaks subscriptions without an explicit lifecycle decision.*

### `00-tui-log-tail-client.md` — consumer contract

- **Pin exported consumer API shape.** Define what `01` injects: async iteration surface, abort/close seam, and error propagation — rules out implementer-chosen AsyncIterable-only vs opaque client object without a cross-subspec contract. *Rationale: `01` depends on merged `00`; API ambiguity is a subspec boundary defect.*

- **Add acceptance criteria for error-payload `stream-end`.** Current ACs treat all `stream-end` as benign completion. Pin whether `{ error }` rejects as `TuiDaemonConnectionError` (or another named error) vs completes empty. *Rationale: shipped IPC server emits error closes; untested behavior will diverge from daemon reality.*

- **Clarify ordering contract.** State passive yield order from server framing — no client reorder — so `01` “arrival order” cannot be read as client-side sort. *Rationale: removes implementer variance without prescribing algorithms.*

- **Restate intent prerequisites on `00`.** Daemon IPC tail stream and `connectIpcClient` transport exist — enables standalone `jarvis run` on `00` without reading intent. *Rationale: prerequisites are validation gates per spec guidance.*

- **Tighten socket-backed test outcome.** Socket case should exercise production tail framing path (per `v2/docs/test-writing.md`), not a reimplemented handler double that could pass while production wiring regresses. *Rationale: test-writing prefers real transport/integration where behavior is the contract.*

### `01-tui-log-follow-view.md` — rendering and tests

- **Pin minimal per-`event.kind` field projection.** Table mapping kinds to nested fields (`iteration_started` → `attemptId`; `boundary_committed` → `attemptId`, `outcomeKind`, `runStatus`; `loop_finished` → `loopOutcomeKind`, `iterationsConsumed`, `resumable`; `run_execution_failed` → kind only). *Rationale: task checklist flattens `event.*`; without a pin, view-host tests and `write-behavior` output contract can diverge.*

- **Add ink production guard AC** mirroring scaffold `01`: production `jarvis tui log` imports and renders through ink, not a stdout shim. *Rationale: scaffold precedent; fake view-host tests alone permit a non-ink production entry.*

- **Add AC for injectable quit → exit `0`.** *Rationale: `write-behavior` doc AC cites “stream end/quit” but nothing testable pins quit today.*

- **Add AC(s) for mid-session tail failure** after disconnect/error-`stream-end` decision is pinned. *Rationale: behavioral coverage gap on a realistic failure path.*

- **Cite shared unavailable-daemon feedback surface** (`TUI_DAEMON_SOCKET_DISPLAY`, scaffold feedback helper/constants) in decision or task — rules out ad hoc string duplication. *Rationale: shipped scaffold already pins this contract.*

### Documentation (required with `01`)

- **`v2/docs/daemon-host.md` cross-link** — `jarvis tui log <run-id>` as consumer-layer socket-default caller over IPC tail, same pattern as scaffold `jarvis tui`. *Rationale: intent names `daemon-host.md`; documentation standard requires durable-home alignment when operator semantics ship.*

- **`v2/docs/write-behavior.md` output contract** — AC must require a testable minimum line shape (at least `seq`, `event.kind`, present nested kind fields) even if polish stays deferred — rules out doc/tests drifting on delimiter and field order. *Rationale: intent defers polish, not omission of operator contract at land time.*

- **`v2/docs/v2-architecture.md` Interface** — shipped log follow (`jarvis tui log <run-id>`) as separate TUI surface over IPC tail; aspirational dashboard/multi-window wording unchanged as sibling work. *Rationale: architecture still describes aspirational “separate server window”; scaffold required explicit shipped-vs-aspirational reconciliation.*

### Accepted without refinement

- `00`/`01` subspec split and prerequisite ordering.
- `00` no operator-facing doc updates (internal library; inline doc-comments suffice).
- Out of scope: tail-server semantics, dashboard, retention/search, `parseStreamPayload` sharing with `cli.ts` (deferral stands; optional decision noting intentional TUI vs `run log` divergence is not blocking).
- Unknown run → zero lines, exit `0`; structured lines vs JSONL; refactor preservation ACs citing `tui-entry.test.tsx` and `cli.test.ts`.
- `streamId` demux detail, usage-string prose, module/file naming, `repo:` on `index.md`, `bun run typecheck` as spec AC.
