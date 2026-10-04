# Adjudicator verdict — CLI wait run-completion

**Disposition:** Refine before merge. The subspec contract is largely sound (transport-only, `jarvis run wait`, write-parity exit mapping with wait-specific `3`/`4`), but intent language, operator semantics, enforceability gaps, and one doc target need correction.

---

## Required refinements

### 1. Reconcile invocation-boundary vs lifecycle-terminal language

- **Intent** (`intent.md`): title, scope (“block until terminal”), and prerequisite (“resolves on terminal boundary”) oversell lifecycle completion relative to the daemon `wait` RPC (invocation-boundary / quiescent-edge resolve).
- **Subspec intro**: ensure operator-facing prose matches daemon semantics — one boundary per call, not lifecycle join.
- **Operator docs** (`write-behavior.md`): state explicitly that `jarvis run wait` resolves once per invocation boundary; fleet scripts needing lifecycle success must loop `wait` until exit `0` (or inspect stdout `runStatus` / `resumable`). Non-zero exit does not imply non-resumable.

**Why:** Transport-only CLI cannot promise lifecycle completion without changing daemon semantics (out of scope). Stale intent language will mislead implementers and operators.

### 2. Pin exit-code precedence and simplify budget-soft-stopped rule

- Add a decision ledger entry: present `loopOutcomeKind` wins; `runStatus`-only mapping applies only when loop fields are omitted — rules out exit `5` (or any non-zero) when `loopOutcomeKind: "complete"`.
- Replace the ambiguous AC clause “`budget-soft-stopped` with no contradicting success kind” with precedence-based wording aligned to the decision.
- Decision prose: say “extends `jarvis write` exit mapping” (not “aligns”), and name `3`/`4` as wait-specific `runStatus`-only fallbacks.

**Why:** The current budget AC is undefined under contradicting payloads; implementers need a single precedence rule.

### 3. Add missing acceptance criteria

| Gap | Required outcome |
| --- | --- |
| Quiescent immediate resolve | AC: already-quiescent run returns immediately with correct exit (e.g. `paused` / `budget-exhausted` with present `loopOutcomeKind`). |
| Blocking in-progress resolve | AC: injected client does not receive `wait` response until simulated next boundary (mirrors daemon test shape). |
| `runStatus`-only fallbacks | AC beyond `failed`→`3` and `killed`→`4`: at least one other omitted-loop terminal status → `1` (or document as daemon-owned untestable edge with rationale). |
| Run-control usage | AC: `RUN_USAGE` lists `wait` (fold into missing-run-id AC or standalone). |
| Empty run ID | AC: empty-string run ID forwarded → daemon `invalid_params`, stderr `<code>: <message>`, exit `1`. |
| Malformed success payload | AC: invalid daemon success response → stderr `invalid daemon response`, exit `1` (parity with sibling run-control verbs in `cli.ts`). |
| Documentation updates | AC per listed doc home (`write-behavior.md`, `v2-architecture.md`, `v1-behaviors.md`) — spec guidance treats docs as deliverables, not task-checklist-only. |

**Why:** Task checklist items without ACs are not enforceable at run completion; gaps match real operator/error paths and sibling verb patterns.

### 4. Fix architecture cross-link target

- Change `v2-architecture.md` documentation update from Interface/Steering to **Observability** (primary; ~L249) or **Orchestration API** (~L515). Keep one-sentence cross-link; no duplicate wire contract.

**Why:** `wait` is documented under Observability/Orchestration API, not Steering (pause/resume/kill).

### 5. Add subspec Prerequisites

- Cite merged daemon `wait` RPC spec (`v2/spec/2026-06-30T03-06-16Z-daemon-wait-run-completion-2/`) as dependency.

**Why:** Implementer ordering and prerequisite gate per spec guidance; daemon ACs are satisfied in tree.

### 6. Pin stdout JSON contract

- Decision/AC: single-line minified JSON (`JSON.stringify` default), newline-terminated — rules out pretty-printed multi-line (differs from foreground `write`).
- AC or decision: stdout omits absent keys — rules out `null` placeholders for omitted daemon fields.

**Why:** Scripting ergonomics and faithful daemon pass-through need explicit shape.

### 7. Close intent command-tree deferral

- Decision ledger: `jarvis run wait <run-id>` closes intent deferral — rules out top-level `jarvis wait` and flag-on-existing-verb alternatives.

**Why:** First-consumer pin is load-bearing; back-reference aids reviewers tracing intent → subspec.

---

## Upheld without refinement (contract stands)

- Transport-only over one `wait` RPC; no `list` poll or log-stream filtering.
- `loopOutcomeKind` present → write-parity mapping (`0`/`1`/`2`/`5`); collapsing `blocked`/`contract_miss`/`paused`/`progress` → `1`.
- Quiescent immediate resolve with non-zero exit is correct RPC passthrough.
- Unbounded block on pending `wait` response.
- SIGINT during long `wait` is out of scope for this slice.
- `v2/src/cli.test.ts` preservation AC is well-formed per spec guidance.

---

## Decision ledger (refinement additions)

- Invocation-boundary resolve per call — rules out lifecycle-terminal wording in intent/operator docs.
- `loopOutcomeKind` precedence over `runStatus` — rules out dual-trigger exit codes on mixed payloads.
- Exit mapping extends write with wait-only `3`/`4` — rules out claiming full write parity.
- Stdout minified single-line; omit absent keys — rules out write-style pretty-print and `null` padding.
- Architecture cross-link targets Observability/Orchestration API — rules out Steering section.
- `jarvis run wait` closes intent command-tree deferral — rules out top-level `jarvis wait`.
