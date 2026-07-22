## Verdict — changes required

**Blocking**

1. **`v2/src/commands/workflow.test.ts` is stale and red.** Three tests (around lines 111, 142, 185) still exercise the removed auto-bounce path, the `status` guard params, and `--no-auto-bounce` on `run workflow implement`. The file was never swept. `run workflow` now goes through the plain connect-and-dispatch helper, so these assert deleted behavior. Outcome: `bun run test:v2` passes, and the surviving workflow-dispatch tests describe the new behavior (dispatch proceeds regardless of the daemon's loaded digest; `--no-auto-bounce` is rejected as an unknown flag with usage output). AC "existing lifecycle/auto-start tests stay green" is not honestly tickable until this holds.

2. **`v2/src/daemon/daemon-reconciliation.test.ts` (~lines 505–525) is stale and red.** It drives the daemon's `status` handler with `{currentRevision, currentExecutableDigest}` and expects `loadedRevision` to advance to `"invoking-head"`. The in-process advance was deliberately deleted, so the handler now echoes the boot revision. Outcome: that expectation is removed (the behavior is intentionally gone — do not restore the advance), and the daemon test file is green.

3. **`v2/docs/write-behavior.md` (~line 660) is cut mid-sentence and contradicts the code.** The paragraph now ends `…an executable-digest mismatch lists runs and` with no blank line before the `**Keyed-daemon auto-start:**` block, and the surviving prose still claims the CLI sends `{ currentRevision, currentExecutableDigest }` on `status` and that the daemon advances `loadedRevision` in-process. Both are removed. Outcome: the whole pre-dispatch-guard paragraph is gone, the keyed-auto-start paragraph stands alone with correct surrounding blank lines, and no durable doc describes the guard, the bounce, or the in-process revision advance. This is subspec 00's own documentation-updates item for this file, currently unmet.

**Required cleanups in the same pass**

4. **Delete `v2/src/cli/dispatch-revision.test.ts`.** It was truncated to zero bytes instead of removed.

5. **The "even with live runs" resume test in `v2/src/commands/run.test.ts` has no live runs.** AC #1 explicitly covers the `isLive` case. Either set up a `list` reply containing an `isLive: true` row so the test earns its name and the AC clause, or rename it to what it actually covers.

6. **The "without status calls" assertion is vacuous.** The shared IPC test helper intercepts and auto-replies to `status` frames before recording them, so asserting zero recorded `status` frames passes under both old and new code. Either assert something that would actually fail against the pre-change guard, or drop that test — it is a near-duplicate of the preceding digest-mismatch test, which does carry AC #1's regression weight honestly.

7. **Retire the guard-only test scaffolding.** Once findings 1 and 6 land, the `status` auto-reply branch and the `statusCalls` / `statusResponses` / `loadedRevision` / `loadedExecutableDigest` options in the CLI test helper have no consumers, and the `cliMain` docstring reference to "dispatch guards" is wrong. Outcome: no test infrastructure exists solely to support the deleted guard.

8. **`CliDeps.getCurrentRevision` is now dead in production.** Only the declaration and its wiring remain; `daemon status` reads its own injected option, not this seam. Either drop it from `CliDeps` or state in the subspec why it is deliberately retained — the spec's stated justification ("`daemon status` still calls them") holds for the digest helper but not for this field as wired.

9. **`v2/docs/v1-behaviors.md` source list.** The `daemon status` bullet still cites `v2/src/cli/dispatch-revision.ts` as part of the comparison path; that module is now just two `getInvoking*` helpers. Trim the citation so the source list reflects reality.

**Not upheld:** the removed end-to-end lost-start-race test (the branch is still pinned by `connectWithAutoStart` coverage in `stale-dispatch.test.ts`, per AC #7); the `--no-auto-bounce` rejection test asserting only usage output (parsing rejects before any connection, which is exactly what AC #3 asks); inlining `() => Promise<string>` in place of the removed type aliases (style only, and a direct consequence of shrinking the module's exported surface).