# 02 - Await the remaining daemon-reachable subprocesses

Two blocking subprocess sites remain on daemon-hosted paths, and the guard in subspec 03 cannot pass while they stand:

- `getBaseBranch` in `shared/git.ts` (`execFileSync("gh", ["repo", "view", …])`), called by `v2/src/execution/intent-workflow-steps.ts` and `v2/src/execution/plan-workflow-steps.ts` (both already `await` the result).
- `runMarkdownlintAutofix` in `shared/markdownlint-repair.ts` (`execFileSync("bun", [markdownlint, "--fix", …])`), reached from the daemon through `shared/intent-stage.ts` `validateIntentStage` → `repairIntentStageContent`, called by `v2/src/execution/intent-output.ts`.

`runMarkdownlintAutofix` has three call sites, all of which cascade to async: `shared/intent-stage.ts`, v1's local intent repair in `v1/src/commands/intent.ts`, and v1's plan-pipeline repair in `v1/src/modes/plan/markdown-repair.ts`.

## Decisions

- Route both through `AsyncSubprocessRunner`; rules out per-module `execFile` wrappers.
- Make `getBaseBranch` async in place rather than adding a `getBaseBranchAsync` twin; its only importers are the two v2 workflow-steps modules, which already await it, and a lingering sync twin is exactly what the guard exists to prevent.
- Propagate async through `repairIntentStageContent` / `validateIntentStage` and through all three `runMarkdownlintAutofix` call sites, awaiting in `v2/src/execution/intent-output.ts`, `v1/src/commands/intent.ts`, and `v1/src/modes/plan/markdown-repair.ts`; rules out spawning the autofix detached, which would race the validation that reads the repaired files.
- Leave the remaining `shared/git.ts` synchronous helpers (`branchExistsLocal`, `branchExistsOnOrigin`, `getCurrentBranch`, `isWorktreeDirty`, `isGitRepo`) alone — they have async twins already and only v1 CLI code calls the sync forms; subspec 03 decides where they may live and whether v2 may import them.
- Small synchronous filesystem reads (`readFileSync`, `readdirSync`) in these paths stay as-is; only child processes are in scope.

## Acceptance criteria

- [ ] No daemon-hosted intent or plan step blocks the event loop on a child process: base-branch resolution and intent-stage markdownlint repair are awaited async subprocess calls.
- [ ] Intent-stage repair still runs before stage-content validation, so validation reads the repaired files.
- [ ] `shared/intent-stage.test.ts` and the v1 intent tests stay green (behavior unchanged by the conversion), including markdownlint autofix warnings and the issue-reference guard.
- [ ] `v1/test/plan-markdown-repair.test.ts` stays green (v1 plan markdown repair unchanged by the async cascade).
- [ ] `bun run typecheck` passes with no synchronous `getBaseBranch` / `validateIntentStage` / `runMarkdownlintAutofix` callers left in `v1/**` or `v2/**`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that base-branch resolution and intent-stage repair are async in v2's shared path.
