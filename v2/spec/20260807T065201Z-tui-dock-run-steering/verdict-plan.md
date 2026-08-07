# Verdict: Typed dock run steering

## Required refinements

### 1. Collapse the mislabeled subspec split

Replace `00-daemon` and `01-cli` with a single index-linked subspec that owns the full TUI seam: parser kinds, `submitCommand` dispatch, tests, operator runbook, and `v1-behaviors`. The current split mislabels TUI-only work, leaves `01-cli` with empty decisions, duplicates work, and makes the runbook/parser AC non-independently implementable until the other half lands. Every original task and acceptance outcome must appear exactly once in the replacement; index must link only the new subspec.

### 2. Name the ineligible-selection feedback contract

Pre-RPC refusal must use stable `lastCommandResult` codes, not unnamed “named feedback.” The spec must state which codes apply for each refusal reason: reuse the expansion selection-shape codes (`no_selection`, `run_leaf`, `unattributed`, `stale_non_expandable`) where selection shape blocks dispatch; add at least one run-steering-specific code for live-run predicate failure. Pin the codes in the ineligible-selection test so the AC is falsifiable. Pre-RPC refusal stays on `lastCommandResult`; RPC outcomes stay on `steeringFeedback` — that split is intentional and should remain explicit.

### 3. Specify eligibility before RPC, including selection shape

Typed run steering must not hit the silent `runId === null` path used by keybind `runAction`. The spec must require a selection-shape guard before the live-run predicate, using the same expansion-style selection errors for pipeline/stage, unattributed, and stale non-expandable selections. For kill and pause, pinning pre-RPC eligibility to the existing kill-hint predicate (`isLive`, `isActiveRunStatus`, `actionableRunIds` when present) is acceptable and matches intent’s “selected live run.” For `resume-run`, the spec must resolve parity with keybind resume: either broader pre-RPC eligibility (e.g. resumable killed/paused runs) or an explicit decision that typed `resume-run` is narrower than keybind resume, with a named code when blocked. Default expectation is parity with `runSteeringAction("resume", true)` — the current kill-only predicate would wrongly pre-block resume on killed rows that keybinds still attempt.

### 4. State pending-admission policy

`submitCommand` already blocks some verbs during pending pipeline admission. The spec must decide whether typed `kill`, `pause`, and `resume-run` are blocked in that state. Recommended outcome: not blocked — steering an existing run is orthogonal to starting a new pipeline — but the decision must be recorded so implementers do not guess.

### 5. Strengthen acceptance criteria for new behavior

Add or adjust ACs so every new runtime behavior has a pre-fix-failing test and observable proof:

- Parser: baseline-fail AC for `kill` and `pause` graduating off `recognized_unavailable`, not only `resume-run`.
- Entry: separate success AC from ineligible AC — success test covers live-run steering only; ineligible matrix stays in the pinned mutation test.
- Entry: AC that typed `resume-run` passes `rewaitOnSuccess` (observable wait-state return to pending or equivalent), not merely that a `resume` RPC fires.
- Ineligible test: cover at minimum pipeline/stage selection, non-actionable retained row, and resume-on-killed if resume gets broader eligibility.

Parser trailing-token rejection may remain covered by the existing bulk parser mutation pin; no separate per-guard AC required if that pattern already applies.

### 6. Keep prerequisite as implementation sequencing, not design rework

Fan-out after merged `tui-dock-pipeline-steering` is correct — both slices touch `submitCommand`, `TuiCommand`, and `UNAVAILABLE_COMMANDS`. The spec should not be implemented until upstream merges; if upstream is still unmerged at plan-merge time, treat that as a merge blocker for starting implement runs, not as a reason to redesign this slice.

### 7. Documentation ownership in the unified subspec

Operator runbook § Observe / Dock commands and `v1-behaviors` in-TUI run steering belong in the same subspec as the code change. ACs must verify live `kill`/`pause`/`resume-run` verbs and removal of CLI-fallback rows for those verbs.

## Rationale

The intent and core seams (`runSteeringAction`, distinct `resume-run`, no parallel dispatch) are sound. The draft fails on spec-structure and behavioral contracts: atomic subspecs must map to real module boundaries; runtime-behavior ACs must name pre-fix-failing tests and falsifiable feedback codes; and eligibility must not contradict existing keybind semantics or produce silent no-ops. Collapsing the split and tightening eligibility/feedback contracts aligns the spec with spec guidance (atomic subspecs, mutation checkpoints, agent-verifiable ACs) without changing the product goal.

## Not required

- Splitting parser and entry into serial implement runs on the same seam.
- Per-guard mutation ACs for parser `unexpected_arguments` if bulk parser pins already cover those guards.
- Mandating `tui-overhaul-brief.md` updates unless operator parity discipline requires it.
- Pre-RPC special cases for per-verb daemon policy (e.g. pause on workflow-started runs) — daemon rejection via `steeringFeedback` matches keybind behavior.
- Deferring buffer/focus/post-success UX beyond the existing “deferred to first consumer” note.