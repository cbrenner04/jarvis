# Fail-closed PR ownership gate

## Problem

`gateOnOpenPrs` (`cleanup.ts`) catches `listOpenPrsForBranch` failures and sets `openPrs = []`, so a failed `gh pr list` probe is indistinguishable from a confirmed zero-open-PR branch. `--abandon` and `resetStaleWorkspace` then proceed as if no open PR protects the branch. Merged-worktree eligibility already fails closed on `gh` failure via `isMerged`; this slice aligns the ownership gate with that policy.

## Decision ledger

- Represent `listOpenPrsForBranch` failure as `{ status: "unknown"; reason: string }` at `gateOnOpenPrs`; rules out folding probe failure into `{ status: "ok"; pr: undefined }`.
- Map `unknown` to pre-mutation refusal in `--abandon` and `resetStaleWorkspace` before live-held, claim, dirty, and retirement steps; rules out probe failure widening destructive permission.
- Reuse one shared refusal reason naming `gh` reachability and retry outside the agent sandbox for both destructive paths; rules out presenting an inconclusive probe as branch state.
- Leave merged-worktree `checkEligibility` / `isMerged` fail-closed behavior unchanged; rules out opposite `gh` failure policies in one command.
- `classifyNeverLandedLane` inherits fail-closed via `prGate.status !== "ok"` without a dedicated test in this slice; rules out scope creep into disposable-lane classification ACs.

## Task checklist

- Replace the `catch { openPrs = [] }` path in `gateOnOpenPrs` with an explicit `unknown` outcome carrying probe failure detail.
- Refuse `runAbandonCommand` before preview, confirmation, or retirement when `prGate.status === "unknown"`.
- Refuse `resetStaleWorkspace` before dirty, descendant, landed-criteria, or retirement steps when `prGate.status === "unknown"`.
- Add regression tests in `cleanup.test.ts` for unknown vs confirmed-empty outcomes, `--abandon` no-mutation refusal, stale-reset no-teardown refusal, and preserved zero-open-PR paths.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `cleanup.test.ts` proves a thrown `gh pr list` probe yields `gateOnOpenPrs` status `unknown` distinct from a confirmed empty list returning `ok` with `pr: undefined`; it fails against the pre-fix `catch { openPrs = [] }` path reachable in `v2/src/commands/cleanup.ts`.
- [ ] `cleanup.test.ts` proves `--abandon` exits nonzero without prompting or changing the worktree, local branch, remote branch, or PR when `gh pr list` fails; stderr names `gh` reachability and sandbox recovery, and the test fails against the pre-fix silent pass reachable when probe failure is treated as zero open PRs.
- [ ] `cleanup.test.ts` proves `resetStaleWorkspace` refuses without teardown when the PR probe fails; it fails against the pre-fix permissive fallback reachable in `v2/src/commands/cleanup.ts`.
- [ ] `cleanup.test.ts` tests `abandon succeeds when the repo has no origin remote` and `reset removes stale worktree and draft PR before re-run` stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None in this subspec; operator and parity docs land in subspecs 01 and 02.
