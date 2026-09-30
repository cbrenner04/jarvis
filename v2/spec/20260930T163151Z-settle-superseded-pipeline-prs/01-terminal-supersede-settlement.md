# Terminal supersede settlement

## Problem

Successful terminal `ready` or `merge` publication leaves earlier intent and plan PRs open even though the final PR carries their work.

## Decisions

- Invoke supersede only after `commitTerminalPublicationSuccess` succeeds for `terminalAction` `ready` or `merge` when admitted `pipeline.definition.supersede === "close"` — rules out supersede inside `executeTerminalPublication`, on `leave-draft`, before terminal success is durable, or when the field is omitted on test fixtures that are not admission-shaped.
- Run supersede once in the same `settlePipelineTerminalPublication` invocation that commits terminal success; `isPipelineSettlementPending` is false when `terminalPublicationSucceededAt` is already set, so daemon restart does not re-run supersede — rules out idempotent settlement retry on recover without an expanded intent.
- `ready` and `merge` share one post-success supersede hook; a stubbed `ready` settlement test alone pins it — rules out a merge-only code path left untested while intent treats both actions symmetrically.
- Skip the entire pass when `findFanOutSplit` is truthy, `definition.supersede === "keep"`, terminal publication did not succeed in this settlement, or `terminalAction` is `leave-draft` — rules out partial supersede on fan-out refusal (terminal success never committed) and on `keep`.
- Candidates: default-lane workflow stages with `status === "succeeded"` strictly before the terminal workflow stage in `definition.stages` order, each with `artifact.prNumber` — rules out approval rows, the terminal stage PR, sibling branch stages, and a GitHub open-state pre-check; already-closed or duplicate PRs fail at comment/close and append `supersedeFailures` — rules out silently diverging from intent “every open PR” without recording failures.
- Comment `#<n>` uses `prNumber` from the successful `executeTerminalPublication` return (`TerminalPublicationResult`), i.e. the terminal publication outcome after ready flip/merge inside production `executeTerminalPublication`, not `resolved.input.prNumber` alone — rules out citing the pre-flip artifact number when publication retargets.
- Comment `stage <stageId>` is the **candidate** workflow stage id (the superseded PR’s stage), not the terminal stage — rules out attributing every comment to the terminal stage id.
- Per candidate: resolve `worktreePath` from `store.loadRun(artifact.entryRunId)` and pass it into injectable `comment`/`close` (same entry-run cwd pattern as `resolveTerminalPublicationInput`) — rules out reusing only the terminal stage worktree for all preceding PRs.
- Comment body exactly `Superseded by #<n> (pipeline <id>, stage <stageId>)` with `<n>`, `<id>`, and candidate `<stageId>` as above — rules out free-form operator text.
- Per candidate: comment must succeed before close; never call branch delete — rules out close-first ordering and cleanup-style branch retirement (slice 3 of the merged hygiene seed).
- On per-PR errors, append `{ prNumber, message }` via `appendSupersedeFailures` and continue remaining candidates — rules out aborting the pass or rolling back terminal success.
- Injectable GH seams on `PipelineExecutionDeps` (`comment` + `close` only) — rules out subprocess calls directly in `pipeline-execution.ts` and reusing `terminal-publication` close/delete helpers that destroy evidence.

## Tasks

- [ ] Add `settleSupersededPrecedingStagePrs` (or equivalent) in `pipeline-execution.ts`; call from `settlePipelineTerminalPublication` after successful terminal success commit when policy and terminal action qualify.
- [ ] Capture `TerminalPublicationResult` from `await execute(resolved.input)` and pass `prNumber` into the comment template (omit or skip candidates when `prNumber` is undefined).
- [ ] Extend `pipeline-execution.test.ts` fake store with `appendSupersedeFailures` / `supersedeFailures` when needed for assertions.
- [ ] Add stubbed-GH tests under `pipeline terminal publication settlement` (or adjacent describe): multi-stage single-lane `ready` with `supersede: "close"` and distinct preceding PR artifacts — assert comment-before-close call order per PR, per-candidate worktree cwd, and no delete-branch seam invocations.
- [ ] Same harness: `supersede: "keep"`, `leave-draft`, and fan-out definitions issue zero supersede seam calls (fan-out case reachable on today’s terminal publication refusal path where `terminalPublicationSucceededAt` stays unset in `pipeline-execution.test.ts`).
- [ ] Same harness: injected comment failure records `supersedeFailures`, continues other candidates, leaves `terminalPublicationSucceededAt` set and `derivePipelineState` `succeeded`.
- [ ] Update docs listed below; adjust `v2/docs/v1-behaviors.md` entry that says no harness path reads `supersede` yet.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` drives a stubbed single-lane `ready` settlement with `definition.supersede === "close"` proving comment-before-close on preceding PRs with no branch deletion; proves the exclusion set (`keep`, `leave-draft`, fan-out with terminal success not committed) issues no supersede seam calls; proves failures record `supersedeFailures`, continue candidates, and still derive `succeeded`; fails against the baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/pipeline-execution.md` — supersede ordering, exclusions, and nonfatal failure at terminal publication.
- [ ] `v2/docs/first-workflow-walkthrough.md` — inter-stage PRs are review surfaces; terminal settlement closes them under `"close"`.
- [ ] `v2/docs/daemon-host.md` — cross-link terminal supersede settlement (`pipeline-execution.md`).
- [ ] `v2/docs/v1-behaviors.md` — supersede settlement at terminal publication (supersedes the v2-only “no harness consumer yet” `pipeline.supersede` note).
