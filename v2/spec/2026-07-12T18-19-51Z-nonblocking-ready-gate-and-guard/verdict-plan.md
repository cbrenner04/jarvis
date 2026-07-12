## Verdict — refinements required

### Subspec 00 (ready gate / flip)

1. **The async runner cannot carry the current error contract.** `realAsyncSubprocessRunner.runAsync` in `shared/subprocess.ts` rejects with a raw Node `execFile` error: the stderr callback argument is discarded, and the error carries `.code`, not `.status`. The finalizer's existing behavior depends on `err.status` (for `ready gate failed (exit N)`) and on `err.stdout`/`err.stderr` for the `already ready` / `not a draft` success guard. So the drafted decision "route both through `AsyncSubprocessRunner`" plus the AC "preserve the exit-status/stderr message and the success guard" are mutually unsatisfiable as written — an implementer would either drop the guard or silently rely on Node folding stderr into `error.message`, which is incidental and untested. The spec must decide explicitly how the async failure path surfaces exit code and captured stderr (e.g. extending the shared runner's reject shape), state it as a decision, and cover it in an AC. Also pin output-buffer sizing for `bun run ready`, whose output is large.
2. **Correct the seam-widening claim.** Widening `ReadyGate` / `GhReadyFlip` to `Promise<void>` does change existing test doubles at the type level; the parenthetical implying no double churn is false, and AC 3 currently reads as "no test changes." State the actual contract: seam names and parameters preserved, return types become promises, doubles become async, assertions unchanged.

### Subspec 02 (remaining daemon-reachable subprocesses)

3. **Strike the false v1 claim.** No `v1/**` module imports `getBaseBranch` from `shared/git.ts` (v1 has its own async one in `v1/src/gh.ts`); the only importers are the two v2 workflow-steps modules, which already await. Remove "Update v1 callers to await."
4. **Name the full markdownlint blast radius.** `runMarkdownlintAutofix` has a third call site the subspec never mentions — `v1/src/modes/plan/markdown-repair.ts`, on v1's plan pipeline (in addition to `shared/intent-stage.ts` and v1's local repair in `v1/src/commands/intent.ts`). Making the shared function async cascades there. Name it, and add an AC that v1 plan markdown repair stays green (cite `v1/test/plan-markdown-repair.test.ts`).

### Subspec 03 (guard)

5. **Close the shared-git guard hole.** `branchExistsLocal`, `branchExistsOnOrigin`, `getCurrentBranch`, and `isWorktreeDirty` in `shared/git.ts` block internally via the default sync runner parameter. A v2 module importing any of them would block the event loop and pass the drafted rejected-construct list clean. Subspec 02 defers this to 03; 03 must actually decide — either the guard bans v2 importing these sync-named helpers (async twins exist), or they move out of `shared/`.
6. **Pin violation coverage as contract, not mechanism.** The rejected-construct list only addresses static ESM imports; `require("node:child_process")` and dynamic `await import(...)` are unaddressed. State which forms count as violations and cover them in the guard's unit-test fixtures; leave regex-vs-AST to the implementer.
7. **Scope the clean-tree AC honestly and sequence the guard.** Say the guard exits zero on the tree *as of this subspec* (the current tree is only clean given the `v2/src/testing/**` exclusion), and note that 03 lands after 00 and 02, whose conversions it depends on.

### Cross-cutting (subspec 01)

8. **Fix the two decision lines that misdescribe the test.** The test necessarily passes a real finalizer constructed with a held gate seam *as* the `readyFinalizer` seam, so the "rules out stubbing `readyFinalizer` wholesale" phrasing contradicts the mechanics; the distinction actually wanted is "compose the real finalizer with a held gate, not a fake finalizer." And injecting the gate seam pins that the finalizer *awaits* it — it does not by itself prevent a revert to `execFileSync`; that protection comes from 00's import AC and 03's guard. Reword both; the test design itself is sound.

### Rationale

The four-way split is correct and no subspec is oversized — these are corrections within the existing files. Items 1, 4, and 5 are the load-bearing ones: as drafted, 00's ACs cannot all be satisfied, 02 under-scopes a change that breaks a v1 pipeline, and 03's guard fails to enforce the very invariant the intent names. Items 2, 3, and 8 remove factually wrong decision/AC text, which per spec guidance is where wrong claims enter refactor specs. Items 6 and 7 make the guard's contract complete and its ACs truthful.