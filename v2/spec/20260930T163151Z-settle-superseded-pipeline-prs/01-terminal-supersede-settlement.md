# Terminal supersede settlement

## Problem

Successful terminal `ready` or `merge` publication leaves earlier intent and plan PRs open even though the final PR carries their work.

## Decisions

- Invoke supersede only after `commitTerminalPublicationSuccess` succeeds (`commitTerminalPublicationSuccessSafely` returns whether the commit landed; its failure fallback skips supersede) for `terminalAction` `ready` or `merge` when admitted `pipeline.definition.supersede === "close"` — rules out supersede inside `executeTerminalPublication`, on `leave-draft`, before terminal success is durable, or when the field is omitted on test fixtures that are not admission-shaped.
- Run supersede once in the same `settlePipelineTerminalPublication` invocation that commits terminal success; `isPipelineSettlementPending` is false when `terminalPublicationSucceededAt` is already set, so daemon restart does not re-run supersede — rules out idempotent settlement retry on recover without an expanded intent.
- `ready` and `merge` share one post-success supersede hook; a stubbed `ready` settlement test alone pins it — rules out a merge-only code path left untested while intent treats both actions symmetrically.
- Skip the entire pass when `findFanOutSplit` is truthy, `definition.supersede === "keep"`, terminal publication did not succeed in this settlement, or `terminalAction` is `leave-draft` — rules out partial supersede on fan-out refusal (terminal success never committed) and on `keep`.
- Candidates: default-lane workflow stages with `status === "succeeded"` strictly before the terminal workflow stage in `definition.stages` order, each with `artifact.prNumber`, deduped by `prNumber`, excluding any equal to the terminal `prNumber` — rules out approval rows, sibling branch stages, and ever closing the terminal PR.
- Per candidate: `prState` seam first; skip (no comment, no close, no failure) unless `OPEN` — rules out commenting on already-closed or merged PRs; a `prState` error appends a failure.
- Terminal `#<n>` is `TerminalPublicationResult.prNumber ?? resolved.input.prNumber`; skip the pass when both are undefined — rules out citing the pre-flip artifact number when publication retargets.
- Comment `stage <stageId>` is the **candidate** workflow stage id (the superseded PR’s stage), not the terminal stage — rules out attributing every comment to the terminal stage id.
- All seam calls run with cwd `resolved.input.worktreePath` (same repo, known to exist) — rules out per-candidate entry-run worktrees that cleanup may have removed.
- Comment body exactly `Superseded by #<n> (pipeline <id>, stage <stageId>)` with `<n>`, `<id>`, and candidate `<stageId>` as above — rules out free-form operator text.
- Per candidate: comment must succeed before close; never call branch delete — rules out close-first ordering and cleanup-style branch retirement (slice 3 of the merged hygiene seed).
- On per-PR errors, append `{ prNumber, message }` via `appendSupersedeFailures` and continue remaining candidates — rules out aborting the pass or rolling back terminal success.
- Optional `supersedeGh` seam on `PipelineExecutionDeps` (`prState`, `comment`, `close`), threaded like `executeTerminalPublication`; production default in `terminal-publication.ts` runs `gh pr view --json state` / `gh pr comment --body` / `gh pr close` via the existing `defaultGhCommand` — rules out raw subprocess calls in `pipeline-execution.ts` and reusing the close/delete helpers that destroy evidence.

## Tasks

- [x] Add `settleSupersededPrecedingStagePrs` (or equivalent) in `pipeline-execution.ts`; call from `settlePipelineTerminalPublication` after successful terminal success commit when policy and terminal action qualify.
- [x] Capture `TerminalPublicationResult` from `await execute(resolved.input)`; make `commitTerminalPublicationSuccessSafely` return a boolean gating supersede.
- [x] Extend `pipeline-execution.test.ts` fake store with `appendSupersedeFailures` / `supersedeFailures` when needed for assertions.
- [x] Add stubbed-GH tests under `pipeline terminal publication settlement` (or adjacent describe): multi-stage single-lane `ready` with `supersede: "close"` and distinct preceding PR artifacts — assert comment-before-close call order per PR, no delete-branch seam invocations, no calls for the terminal `prNumber`, and a non-`OPEN` candidate gets neither comment nor close.
- [x] Same harness: `supersede: "keep"`, `leave-draft`, and fan-out definitions issue zero supersede seam calls (fan-out case reachable on today’s terminal publication refusal path where `terminalPublicationSucceededAt` stays unset in `pipeline-execution.test.ts`).
- [x] Same harness: injected comment failure records `supersedeFailures`, continues other candidates, leaves `terminalPublicationSucceededAt` set and `derivePipelineState` `succeeded`.
- [x] Update docs listed below; adjust `v2/docs/v1-behaviors.md` entry that says no harness path reads `supersede` yet.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` drives a stubbed single-lane `ready` settlement with `definition.supersede === "close"` proving comment-before-close on preceding open PRs with no branch deletion, skips non-open PRs, and never touches the terminal PR; proves the exclusion set (`keep`, `leave-draft`, fan-out with terminal success not committed) issues no supersede seam calls; proves failures record `supersedeFailures`, continue candidates, and still derive `succeeded`; fails against the baseline.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [x] `v2/docs/pipeline-execution.md` — supersede ordering, exclusions, and nonfatal failure at terminal publication.
- [x] `v2/docs/first-workflow-walkthrough.md` — inter-stage PRs are review surfaces; terminal settlement closes them under `"close"`.
- [x] `v2/docs/daemon-host.md` — cross-link terminal supersede settlement (`pipeline-execution.md`).
- [x] `v2/docs/v1-behaviors.md` — supersede settlement at terminal publication (supersedes the v2-only “no harness consumer yet” `pipeline.supersede` note).
