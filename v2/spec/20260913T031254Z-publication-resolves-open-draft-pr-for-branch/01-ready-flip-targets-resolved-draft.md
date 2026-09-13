# Ready-flip defaults target the resolved draft, not the branch

## Problem

Both default ready-flip paths — `defaultGhReadyFlip` in `v2/src/execution/ready-finalize.ts` and the ready-flip closure in `v2/src/execution/terminal-publication.ts` — invoke `gh pr ready <branch>`, so GitHub picks whichever PR it considers "the" PR for that branch, which can be a dead one behind [subspec 00](./00-completion-publication-resolves-open-draft.md)'s fix. Depends on subspec 00 for the exported open-draft resolver and its named state errors.

## Decisions

- `ready-finalize.ts`'s default flip targets the PR number the caller already resolved this same publication call (`publishCompletionArtifacts`'s `publisherResult.prNumber`, threaded onto a new `ReadyFinalizeInput.prNumber`) — rules out re-resolving via branch/base at flip time, since subspec 00 already confirmed that number is an open draft moments earlier in the same call.
- `terminal-publication.ts`'s default flip re-resolves current open-draft state via subspec 00's exported resolver (by branch/base) immediately before flipping, rather than trusting the persisted `prNumber` it's handed — rules out flipping a number that predates a terminal action running long after an earlier subspec's publication, which is the reused-branch race this intent targets.
- Only the ready-flip closure changes to a number-keyed signature; `ghMerge`, `ghClose`, and `ghDelete` keep their existing branch-keyed `GhReadyFlip` type, since the intent scopes to `defaultGhReadyFlip`-family call sites only — rules out a broader merge/close/delete signature migration this fix doesn't need.
- An open non-draft or no-open-draft state found during `terminal-publication.ts`'s pre-flip resolution refuses with subspec 00's named errors before `gh pr ready` runs and before `failTerminalPublication`'s close/delete cleanup runs — that cleanup would destroy the PR the refusal's recovery text tells the operator to mark draft again, so this refusal returns a `TerminalPublicationError` directly instead of routing through the existing `runReadyFlipOrFail` → `failTerminalPublication` path.
- The retry-scoped success guard (`isPrReadySuccessGuard`, "already ready" / "not a draft" treated as success without retry) stays unchanged on `ready-finalize.ts`'s `flipWithRetry`: it only fires on an error from an actual `gh pr ready` attempt this run, recovering a flip that landed but whose response was lost. A pre-flip refusal is disjoint from it by construction — it fires before any `gh pr ready` call this run, only when the resolved/threaded PR number is missing or non-draft up front — so no case is checked by both, and retry recovery survives.
- The no-open-draft and open-non-draft errors keep the existing `ready_flip_failed` failure-kind and `resumable: false` classification (`workflow-runner-resume.ts`'s `resumable: !isFlip`) — this fix replaces the raw GitHub message with a named actionable one; changing resumability or failure-kind policy is out of this seam's scope.
- Tests exercise these paths through the existing injected `ghReadyFlip`/resolver seams; no live GitHub calls.

## Task checklist

- [ ] Add `prNumber` to `ReadyFinalizeInput`; thread it from `publishCompletionArtifacts`'s publisher result through `runReadyFinalizer`; change `defaultGhReadyFlip` to flip by number.
- [ ] Change the ready-flip closure's type to accept a PR number; update `terminal-publication.ts`'s default flip to re-resolve via subspec 00's resolver and flip the resolved number.
- [ ] Route the open-non-draft/no-open-draft refusal from `terminal-publication.ts`'s pre-flip resolution directly to `TerminalPublicationError`, bypassing `failTerminalPublication`'s close/delete cleanup.
- [ ] Add regression coverage for both default flip callers: closed-only history, open draft, open non-draft, retry-after-successful-flip recovery, and pipeline refusal not destroying PR evidence.
- [ ] Align durable publication and recovery documentation.

## Acceptance criteria

- [x] A regression test in `v2/src/execution/ready-finalize.test.ts` places closed PR history beside the current open draft, confirms the finalizer receives that draft's number, and proves the flip targets the number, never a branch selector; it fails against the pre-fix `gh pr ready <branch>` command.
- [x] A regression test in `v2/src/execution/terminal-publication.test.ts` supplies stale persisted PR evidence for a since-merged PR beside a current open draft on the same branch/base, and proves the default flip re-resolves and targets the open draft's number; it fails against the pre-fix branch-selector default.
- [x] `retries transient gh pr ready errors up to 3 attempts`, `treats already ready stderr as success without retry`, and `treats not a draft stderr as success without retry` (ready-finalize.test.ts) stay green, proving retry-after-successful-flip recovery survives the number-keyed flip.
- [x] A regression test in `v2/src/execution/terminal-publication.test.ts` supplies an open non-draft for the branch/base and observes a failure naming its PR number, branch, expected draft state, and recovery, without invoking `ghClose` or `ghDelete`; it fails against the pre-fix path that reaches `failTerminalPublication`'s cleanup.
- [x] A regression test in `v2/src/execution/terminal-publication.test.ts` supplies only historical (merged/closed) PRs for the branch/base and observes the named no-open-draft error without `gh pr ready` being invoked; it fails against the pre-fix branch-selector default, which forwards GitHub's raw closed-PR string instead.
- [x] `v2/src/execution/ready-finalize.test.ts` gate, mutation, and smoke tests stay green.
- [x] `v2/src/execution/terminal-publication.test.ts` leave-draft, ready-gate, merge, and PR-evidence tests stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — replace branch-keyed ready-flip semantics with numbered-flip resolution and the named open-non-draft/no-open-draft refusals.
- `v2/docs/operator-runbook.md` — remove the known multi-subspec closed-PR workaround; document recovery for an unexpected open non-draft.
- `v2/docs/v1-behaviors.md` — record the state-aware numbered ready transition as a change to existing behavior.
