# Command dispatch

## Problem

The dock submits into an inert handoff, so parsed commands cannot start pipelines or set tree expansion.

## Prerequisites

- `tui-command-parser.ts` returns typed `start`, `expand`, and `collapse` commands plus named errors.
- `00-admission-binding` exposes detached `admitPipelineStart` to monitor controls.

## Decisions

- Parse the submitted buffer exactly once per `submitCommand` and switch on `TuiCommandParseResult` — rules out Ink verb matching or a second grammar.
- Start admission runs asynchronously after `submitCommand` returns and issues one `pipeline_start` with no `pipeline_wait` — rules out blocking Ink or attaching the TUI to completion.
- At most one start admission is in flight; a second focused Enter while pending is ignored and issues no second parse or admission — rules out overlapping detached requests.
- While admission is pending, buffer edits, focus changes, and tree navigation remain available; dispatch never mutates selection — rules out freezing the editor or restoring a captured selection on settlement.
- A settlement applies only when its submission generation still matches the latest editor state; stale settlements must not overwrite newer buffer, cursor, focus, feedback, or selection, and must not render after monitor teardown — rules out racey dock feedback.
- An admitted start reports the pipeline id, clears buffer/cursor, and restores tree focus only after a matching settlement; selection at settlement equals whatever the operator selected during the pending window — rules out focus-and-reveal or pre-submit selection restore.
- Pre-admission and non-refusal admission failures retain command focus/buffer/cursor and report their failure discriminant plus existing detail — rules out unnamed failures or retrying admission.
- A daemon refusal retains command focus/buffer/cursor and preserves admission `detail` unchanged until the existing fixed-row sanitation boundary — rules out rewriting the daemon reason or issuing a second admission.
- Parse errors retain command focus/buffer/cursor and report the parser code; `recognized_unavailable` also reports its exact CLI equivalent — rules out generic usage text or losing repairable input.
- `expand` and `collapse` explicitly add or remove the selected pipeline/stage id; an already-matching state succeeds unchanged — rules out implementing either verb through toggle.
- Unsupported expansion selections report stable feedback codes and retain command focus/buffer/cursor:
  - `no_selection` — no selectable row is selected.
  - `run_leaf` — the selected row is a nested run leaf.
  - `unattributed` — the selected row is an unattributed run.
  - `stale_non_expandable` — the selected pipeline/stage id is absent from the current expandable tree.
- Approval, rejection, resume, run pause/kill, log follow, history, completion, selection reveal, and explicit pending-submission cancellation remain out of scope — rules out absorbing steering or editor follow-ons.

## Work

- Replace the inert `submitCommand` handoff with one typed asynchronous dispatcher for `start`, `expand`, and `collapse`.
- Retain command success/error feedback in monitor state for projection by `02-status-row-projection`.
- Add focused entry, parse-once, concurrency, seed-form, expansion, and source-mutation coverage in `v2/src/tui/tui-entry.test.tsx`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-entry.test.tsx` adds a submission regression that fails against the inert baseline, spies on `parseTuiCommand`, and proves each focused Enter invokes parse exactly once before any admission work.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves valid path-seed and text-seed `start` submissions each invoke detached admission exactly once with the typed project/seed, return control while the promise is pending, and keep render/display updates responsive before settlement.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves a second focused Enter during pending admission performs no second parse or admission, buffer edits and tree navigation remain available, a settlement that arrives after newer editor or selection state leaves that newer state intact, and a settlement arriving after monitor teardown performs no post-close state update.
- [ ] After a matching admitted settlement, the dock retains the admitted pipeline id in command feedback, buffer/cursor are empty, focus is tree, and selection equals the operator's current selection (including navigation performed while admission was pending); no `pipeline_wait` or focus-and-reveal occurs.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves every parser error reports its named code, recognized-unavailable feedback includes its exact CLI equivalent, and parse failures retain buffer/cursor and command focus without admission.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves named pre-admission and non-refusal admission failures retain buffer/cursor and command focus, while a daemon refusal preserves its returned detail verbatim, performs one admission only, and does not clear or retry the command.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves `expand` and `collapse` idempotently set the selected pipeline or stage membership in `expandedPipelineNodeIds`, clear successful commands, retain selection, and perform no admission.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves absent, run-leaf, unattributed, and stale non-expandable selections report `no_selection`, `run_leaf`, `unattributed`, and `stale_non_expandable` feedback respectively while leaving expansion, buffer/cursor, and command focus unchanged.
- [ ] `v2/src/tui/tui-entry.test.tsx` carries a valid `// @mutate` directive for every added or modified dispatch guard, including parse-once routing, single in-flight admission, stale-settlement suppression, selection non-mutation, and explicit-expansion eligibility; inverting each real source condition turns its pin red, negative cases prove suppressed admission/state changes remain absent, and production has no inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — operator and parity docs land in `03-operator-runbook` and `04-parity-catalog`.
