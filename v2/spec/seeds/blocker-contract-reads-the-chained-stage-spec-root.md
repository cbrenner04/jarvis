---
name: blocker-contract-reads-the-chained-stage-spec-root
---

# A chained implement stage's blocker lands on the prior stage's worktree, so the blocker contract never sees it

## Problem

During a chained pipeline implement stage, linked-index routing reads and writes the spec tree on the **prior stage's** worktree (`specReadRoot`), not on the implement code worktree. The agent therefore appends its `## Blocker` to the spec where the spec actually lives — the plan stage's worktree.

The blocker-text contract resolves its target from the implement worktree's `expectedArtifactPath` and arms only when that path `existsSync`. For a chained stage that path does not exist, so no contract is armed, the appended blocker is never observed, and a correctly-blocked run settles `missing_blocker` → `paused` → `unsupported_resume_context`, **non-resumable**.

The operator-visible result is a stage reading `running` / `settlement_deferred` over a run whose status is `paused`, with no blocker anywhere in the worktree the operator would naturally inspect. The blocker exists, is well-formed, and is one directory tree away.

## Evidence

Observed 2026-09-04, pipeline `c8901aa3-6f99-4687-a24b-d48eeabd3196` (project `chess-mvp-yolo-2`, `fast` definition), branch lane `game-result-recording`, entry run `98747dd7-9f5f-4877-bb68-ce244baceccc`.

The run committed its implementation (`fc769d2` "SwiftData game result store"), ticked 4 of 5 acceptance criteria, and appended an accurate blocker for the fifth:

> `make test` fails on `StockfishIntegrationTests.testBeginnerBestMoveFromStartPositionIsLegal` (Stockfish engine crash). Reproduced across multiple serial runs with and without this subspec's changes; blocks the `make test` passes acceptance criterion.

The agent's own reprompt response confirms it wrote the section (`Appended '## Blocker' to '00-swiftdata-g…'`). The file is at `~/.jarvis/worktrees/chess-mvp-yolo-2/plan/game-result-recording/spec/20260904T191054Z-game-result-recording/00-swiftdata-game-result-store.md`. The implement worktree `~/.jarvis/worktrees/chess-mvp-yolo-2/20260904T191054Z-game-result-recording/` contains no spec directory for this lane at all — only the two sibling lanes' trees — and `grep -rl "## Blocker"` over it returns nothing.

The run settled `missing_blocker`, `runStatus: "paused"`, `resumable: false`, `nextAction: "stop"`.

Distinct from the two known `missing_blocker` shapes: the 2026-07-26 case (run `4bfca748`) where the blocker existed only in an uncommitted worktree, and [[outcome-token-parsing-matches-blocked-in-prose]] where the `blocked` classification itself is spurious. Here the classification is correct and the blocker is committed — only the read location is wrong.

## Decisions

- The blocker-text contract resolves its spec path against `specReadRoot` when set, falling back to the code worktree otherwise, so a chained stage observes the blocker where routing already writes it. Rules out resolving the contract solely from the implement worktree.
- When a `blocked` token arrives and no blocker contract could be armed, the run settles a named diagnostic identifying the unresolved spec path rather than `missing_blocker`. Rules out reporting "the agent failed to write a blocker" when the harness could not look.
- A chained-stage run whose blocker is found settles `blocked` with the ordinary `inspect_spec` remediation and a `worktreePath` pointing at the tree that holds the spec. Rules out an operator having to guess which of two worktrees carries it.
- Non-chained runs keep today's resolution and settlement unchanged. Rules out a fix that alters the standalone path.

## Acceptance criteria

- [ ] A new test `chained stage blocker contract resolves against the prior stage spec root` drives a chained implement whose spec tree lives on the prior stage worktree, has the agent append a `## Blocker` there, and asserts the run settles `blocked`; it fails against the pre-fix implement-worktree-only resolution.
- [ ] A new test `blocked token with no armable blocker contract settles a named unresolved-spec diagnostic` asserts the settlement names the spec path it could not resolve and is not `missing_blocker`; it fails against the pre-fix silent fallthrough.
- [ ] A new test `chained blocked run reports the worktree holding its spec` asserts `run list` / `run wait` expose the spec-bearing worktree path for the blocked row; it fails against a row naming only the code worktree.
- [ ] A new test `standalone implement blocker resolution is unchanged` pins the non-chained path; it fails against a fix that reroutes standalone resolution.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Blocked run: for a chained pipeline stage, the blocker lives on the prior stage's worktree; a `paused` / `missing_blocker` row there is a harness read failure, not agent misbehavior.
- `v2/docs/pipeline-execution.md` — chained stage spec-root reads cover the blocker contract, not only routing and criteria writes.
