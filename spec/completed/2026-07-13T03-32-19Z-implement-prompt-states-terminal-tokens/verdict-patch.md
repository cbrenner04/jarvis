Confirmed. Verdict:

## Verdict — one required fix

**Upheld: v1's live patch pipeline still renders an empty terminal-token rules block, defeating the spec's purpose on the runtime that actually produced the incident.**

`v1/src/modes/patch/prompt.ts` (`buildPrompt` and `buildShrinkPrompt`, lines ~83/93 and ~327/335) binds the now-required `STEP_RULES` placeholder to a hardcoded empty string, not `DEFAULT_WRITE_STEP_RULES`. The rendered fixture `v1/test/fixtures/prompts/rendered/patch.prompt.body@r9.shared.txt` confirms this: it contains no terminal-token rules text at all, ending at `## Stop`. `v1/test/prompts/rendered-snapshots.test.ts` only pins the revision bump, not content, so it locks in the empty rendering as correct.

This matters because `prompts/patch/instructions.md` and `prompts/patch/shrink.md` are shared templates rendered by both `v1/src/modes/patch/prompt.ts` and `v2/src/execution/write.ts`. AGENTS.md states v1 is the "current shipping implementation," and `jarvis run` (v1) is the pipeline that produced the 2026-07-13 `blocked`-vs-`progress` incident this spec exists to fix. Shipping `STEP_RULES: ""` in v1 means the agent on the real production path still never sees the token vocabulary — the defect this spec sets out to close is closed only in v2's execution path, not the one that actually failed.

**Required outcome:**

- Both v1 call sites (`buildPrompt` and `buildShrinkPrompt` in `v1/src/modes/patch/prompt.ts`) must bind `STEP_RULES` to the real rules text (`DEFAULT_WRITE_STEP_RULES`, sourced consistently with how v2 supplies it), not an empty string.
- The v1 rendered snapshot fixtures (`v1/test/fixtures/prompts/rendered/patch.prompt.body@r9.*.txt` and any shrink equivalents) must be regenerated to include the real step-rules content, and `v1/test/prompts/rendered-snapshots.test.ts` must assert on that content (not merely the revision number) so a future silent regression is caught.
- `bun run test` (full suite, per the spec's own verification scope) must pass with these fixtures updated.

This is a completion gap in the already-in-scope acceptance criterion "the rendered `patch.prompt.body` and `patch.prompt.shrink` prompts contain the step rules text as their final block" — both templates are shared, so that criterion is unmet if either consumer renders an empty placeholder.