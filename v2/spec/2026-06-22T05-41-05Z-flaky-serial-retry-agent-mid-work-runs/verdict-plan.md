I've verified the load-bearing claims against the code. Both runners shell `bun run test` via `execFileSync` directly with no injectable command seam (the snapshot runner's only seam is the *update* command, not the test invocation); the ready gate's serial path is testable only because it routes through `runCommandFn` and emits three distinct stderr lines. Verdict follows.

## Verdict — refinements required

**1. Make the serial path testable (blocking).**
Subspec 00's acceptance criteria require asserting serial-green-recovers vs serial-red-still-fails, but neither runner has a command seam, and the existing package.json-`test`-script test technique cannot drive the native `bun test` step (it discovers `*.test.ts` files, ignores the package.json script, and the temp dirs contain no test files). The "via the runner's command seam or a co-located test" disjunction in the checklist references a seam that does not exist. The spec must promote command injection to an explicit **Decision** plus checklist items: introduce a `runCommandFn`-style injectable test-invocation parameter into both `runBaseRefTests` and `runSnapshotUpdateRetest` (mirroring `scripts/ready.ts`), since this is a public-signature change of real scope, not a buried test detail. Without it the acceptance criteria are unsatisfiable by a runnable test.

**2. Sharpen the doc-only skip criterion (required).**
Subspec 01's "changes only documentation/prose" trigger misfires against 01 itself: editing `prompts/patch/rules.md` is a `.md` change that is behavior-bearing (revision bump, fixture regen, snapshot tests). And every subspec carries a mandatory `## Documentation updates` section, so "touches docs" cannot be the signal either. Define the skip by **what the suite exercises**, not by file extension: skip `bun run test` only when nothing under a tested path changed — no source, test, prompt fragment, or fixture — i.e. only human-facing prose. State the criterion in those terms so an agent cannot wrongly skip on a prompt-fragment or fixture change.

**3. State plainly that 00 does not close the observed hole and 01 is best-effort (required for operator honesty).**
The triggering incident was the agent shelling `bun run test` mid-work — a path the harness does not wrap and cannot wrap. Subspec 00 hardens base-ref and snapshot blocker-validation runs (real but separate gaps); only 01's prompt guidance touches the observed failure, and prompt guidance is advisory (agents may not honor it). The index/01 must say this directly: 00 does not fix the observed mid-work path, and 01's mitigation is best-effort, not a guarantee.

**4. Mirror the gate's full operator signal, not just recovery (required).**
The gate emits three lines: retry-starting, recovered, and serial-still-failed. Subspec 00 requires only the *recovered* line, while the base-ref runner today swallows its failure silently — so on serial-still-red the operator sees nothing. Since 00's own rationale is "mirror the gate's operator-visible signal," require the same triad (retry-starting + recovered + serial-failed) in both runners.

**5. Add a one-line scope statement for the `bun test` substitution (required).**
`bun run test` → `bun test` equals "drop `--parallel`" only because jarvis's `package.json` test script is `bun test --parallel`. These runners operate on the *target* worktree, which need not use bun test. This is inherited from the gate, not introduced, and is fail-safe (a non-bun target yields the non-green it already returned — it never *creates* a false-block, at worst fails to recover one). Record this as an explicit assumption/Decision so the blast radius is bounded honestly.

**6. Weigh the genuine-red latency cost (required).**
On a real red, blocker validation now pays a full parallel suite **plus** a full serial run inside iteration gating, with no deadline (these runners are synchronous `execFileSync`, unlike the gate). The existing "Deferred to first consumer: per-runner timeout" line covers the mechanism but not the common-case wall-time cost. Add one Decision sentence acknowledging the added serial cost on genuine-red and why it is acceptable (blocker validation is rare / off the hot path), so the deferral is a reasoned choice.

**7. Replace rotting line-number citations (trivial).**
The Documentation-updates references to `v2/docs/v1-behaviors.md` "line ~54" and "line ~339" will drift between draft and implementation. Cite the section/entry heading instead.

These refinements are concentrated and do not expand scope: make the serial path actually testable (1), define the doc-only trigger by coverage not extension (2), and add a handful of honesty/symmetry lines (3–7). No finding requires a redesign, and the prompt-governance Decisions and behavior-preservation ACs in the draft are sound as-is.