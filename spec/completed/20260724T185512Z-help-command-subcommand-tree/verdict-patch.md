## Verdict — changes required

Six ticked acceptance criteria are not backed by the property they assert, and one shipped output contradicts an explicit spec decision. Required outcomes:

**1. `daemon start` must not advertise `WRITE_USAGE` (blocking).**
`v2/src/cli/command-tree.ts` gives the `daemon` → `start` node `usage: WRITE_USAGE`, so `jarvis help daemon start` prints `--project-root/--project/--branch/--base/--spec/--artifact`. `runDaemonCommand` accepts `start` with no flags at all. The spec decision is "`daemon` → `start`, `stop`, `status` (no usage)" — this node must fall back to `DAEMON_USAGE` via the ancestor rule, and a test must pin that output so the copy-paste can't return. (`run start` keeping `WRITE_USAGE` is correct and specced — leave it.)

**2. The dispatch-coverage test must actually detect drift (blocking).**
The AC is: drives *every* tree path through `main()` with stubbed `CliDeps`, asserts none produces its parent's unknown-subcommand usage-and-exit-1 output, and *fails when a tree name has no dispatcher*. The current test asserts `code >= 0` — a tautology that passes for every possible outcome, including the unknown-subcommand exit 1 — and it never reads captured output. Required:
- Assert on the stderr shape the unknown-subcommand path produces (the parent's usage constant), not on the exit code.
- Derive the driven paths by walking `commandTree` rather than a hand-written literal list, so adding a tree name with no dispatcher fails the test. If any path genuinely cannot be driven, the skip must be explicit and visible in the test, not achieved by omission.
- Pass stubbed `CliDeps`. Today the cases run unstubbed, so `config show`/`config path` read the operator's real `~/.jarvis/config.json` and `daemon status`/`run list` dial the real daemon socket — machine-dependent and divergent between the operator box and CI.

**3. Cover `jarvis help run workflow intent-reviewed` as an unknown segment.**
That AC has two halves; only the pre-existing `workflow.test.ts` legacy-alias half is covered. Add the missing half asserting exit 1 with the unknown-segment shape at path `run workflow`.

**4. The did-you-mean inversion AC needs a test that the mutation actually kills.**
Flipping the `closeMatches.length === 1` guard to `!== 1` currently survives every test: with zero matches the inner `suggestion !== undefined` guard suppresses the line anyway, so only a *multi-match* input distinguishes the two. Add a case with several close siblings (e.g. an input within distance 2 of `start`, `stop`, and `status`) asserting no suggestion line is emitted.

**5. Resolve the duplication between `commandEntries` and `commandTree`.**
The spec decision is "`cli.ts` composes each registry entry from a tree node plus its handler." Instead both files independently declare all seven names, summaries, and usage strings, so a command present in one and absent from the other silently yields a dispatchable command whose `jarvis help <it>` reports `unknown command`. Either compose the registry from the tree as specced, or add an assertion that the two name/summary/usage sets agree.

**6. `resolveHelpPath` is dead code.**
The spec named it as the test seam so tests can render a synthetic tree without touching the shipped one; it has zero callers and `renderHelpNode` open-codes the same walk. Either wire it into `renderHelpNode` and add a unit test that resolves/renders a synthetic tree (this also removes the current footgun where `renderHelpNode` silently renders a partially-resolved node for an unresolvable path), or drop the export. Prefer the former — the seam is a stated decision.

**7. Fix the `write-behavior.md` trailer description.**
It says the trailer "names the parent command in square brackets"; the actual output is a backticked path, no brackets. Also check that the escaped backticks inside the code spans render cleanly. And its claim that tree/dispatch drift "is caught by dispatch-coverage tests" is only true once outcome 2 lands.

**Not required:** the stale `HELP_USAGE` text (the spec explicitly authored no new usage constants; `HELP_USAGE` is now only reachable via `jarvis help help`), the `segment === undefined` narrowing in the walk loop (required under `noUncheckedIndexedAccess`), the double traversal on a ≤3-deep tree, and the trailer emitted past a leaf (`jarvis help write nope` → ``run `jarvis help write` for available commands``) which is pinned verbatim by an AC.

Re-verify with `bun run typecheck` and `bun run test:v2` before re-ticking.