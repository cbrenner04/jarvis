# Terminal publication PR-state probe

## Problem

`executeReadyOrMergePublication` always runs the ready gate and flip (and `gh pr merge` for `merge`) without reading whether the implement PR is already merged or closed. Operator-merged PRs make `gh pr ready` fail and the pipeline records `terminalPublicationFailure` although the work landed.

## Decisions

- Add optional `cause` on `PublicationFailure` in `publication-retry.ts`; closed unmerged terminal publication sets `cause: "pr_closed"` — rules out encoding `pr_closed` only in free-form `message` where operators and projections cannot match reliably.
- For `ready` and `merge` only, after `prNumber`/`prUrl` evidence checks and before `runReadyGateOrFail`, probe via existing `deps.gh`: `pr view <prNumber> --json state,mergedAt` — rules out probing inside `resolveOpenDraftPr` (branch-based) or after the ready gate (too late to skip flip).
- Parse `state` from JSON; treat GitHub `MERGED` as terminal publication success: return `{ prNumber, prUrl }` from input without ready gate, `gh pr ready`, or `gh pr merge` — rules out a separate settlement seam, new pipeline-context fields, or notification markers for operator merge.
- GitHub `CLOSED` (unmerged) throws `TerminalPublicationError` with `failure.operation: "gh pr view"`, `failure.cause: "pr_closed"`, and a stable message that the PR is closed and not merged; no ready gate, flip, merge, or reopen — rules out treating closed PRs as inconclusive or attempting `gh pr ready`.
- Any probe error (throw, malformed JSON, missing `state`) is inconclusive: continue the existing ready-gate → flip → optional merge path unchanged — rules out failing publication on transient `gh` errors when the PR may still be an open draft.
- Any parsed `state` other than `MERGED` or `CLOSED` (including unknown GitHub enum strings) is inconclusive: same fallthrough as probe errors — rules out fail-closed on forward-compatible GitHub values without operator need.
- `leave-draft` and paths without `requiresReadyOrMergePublication` do not run the probe — rules out extra `gh` calls on no-op terminal actions.
- `createDefaultSupersedeGh` / supersede settlement unchanged; merged short-circuit success still threads `prNumber` for supersede when applicable — rules out moving probe logic into `pipeline-execution.ts`.

## Tasks

- [ ] Extend `PublicationFailure` with optional `cause`; thread through `TerminalPublicationError` / settlement serialization if the store already persists the failure object shape unchanged.
- [ ] Implement pre-gate probe and branches in `terminal-publication.ts` (`executeReadyOrMergePublication` or a dedicated helper).
- [ ] Extend `terminal-publication.test.ts` fake `gh` to answer `pr view <n> --json state,mergedAt` without breaking existing list/view mocks used by `resolveOpenDraftPr`.
- [ ] Add tests: `MERGED` (`ready` and `merge`), `CLOSED`, probe throw fallthrough.
- [ ] Update documentation listed below.

## Acceptance criteria

- [x] `terminal-publication.test.ts` with fake `gh`: `terminalAction: "ready"` and probe `MERGED` → success with threaded `prNumber`/`prUrl`, no ready gate, no ready flip, and no `gh pr ready`; fails against pre-fix code.
- [x] Same harness: `terminalAction: "merge"` and probe `MERGED` → same success and no gate, flip, `gh pr ready`, or `gh pr merge`; fails against pre-fix code.
- [x] Same harness: probe `CLOSED` → `TerminalPublicationError` with `failure.cause === "pr_closed"`, no ready gate, no ready flip, and no `gh pr ready`; fails against pre-fix code.
- [x] Same harness: state probe throws → ready gate and flip run as before.
- [x] `terminal-publication.test.ts` — `executes each terminal action type once against fake publication` stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/pipeline-execution.md` — extend the terminal-action matrix (or equivalent) for pre-gate PR-state probe and `MERGED` short-circuit (skip gate/flip/merge); operator-merged implement PR → `terminalPublicationSucceededAt`; closed unmerged → `terminalPublicationFailure` with `cause: "pr_closed"`; reconcile `pipeline resume` / terminal-publication-failure prose so `cause: "pr_closed"` is not recoverable by resume/reopen (resume remains for retriable flip/gate failures).
- [ ] `v2/docs/operator-runbook.md` — hand-merging the implement PR before terminal publication is safe; closed unmerged implement PR → terminal publication failure with `pr_closed` (operator action is not resume-and-flip).
- [ ] `v2/docs/write-behavior.md` — pipeline terminal publication probes PR state before ready gate; merged short-circuit (detail in `pipeline-execution.md`).
- [ ] `v2/docs/v1-behaviors.md` — terminal publication no longer fails ready flip when the implement PR is already merged; closed unmerged PR fails with `pr_closed`.
- [ ] `v2/docs/workflow-runner.md` — one-line cross-reference: optional `PublicationFailure.cause` (including `pr_closed`) is canonical in `pipeline-execution.md`.
