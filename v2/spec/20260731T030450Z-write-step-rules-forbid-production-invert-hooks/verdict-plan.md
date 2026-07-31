# Verdict: Required refinements

The spec is directionally sound and matches the intent—a bounded expansion of `DEFAULT_WRITE_STEP_RULES` with render pins and durable docs—but several scope, acceptance, and verification gaps would let an implementer satisfy checkboxes while leaving known breakage or ambiguity unresolved.

## Required refinements

1. **State explicit scope boundaries in Decisions**
   - v2 `plan.prompt.draft` and `patch.prompt.body` are the pin targets; v1 `jarvis1 plan` draft (no `stepRules`) is out of scope for plan coverage.
   - v1 patch still inherits constant changes via the shared render path—note that so fixture refresh is expected, not optional guesswork.
   - `draft.md` and injected `spec-guidance` guard-inversion prose are out of scope; trailing `## Step completion` is the intervention surface for this intent.
   - `intent.prompt.split` and `patch.prompt.shrink` are out of scope for new substring pins; existing wholesale `toContain` coverage remains sufficient.

2. **Clarify enforcement is prompt-only and chain to follow-on work**
   - Decisions or Documentation updates must state that write-step rules are necessary but not sufficient to stop invert hooks.
   - `guard-production-test-flags` owns static enforcement; this spec owns the guard-inversion evidence contract and invert-hook prohibition in prompts and `test-writing.md`, with a one-line handoff so doc sections do not duplicate or conflict.

3. **Rewrite acceptance criterion #2 to remove “comment checkpoint” ambiguity**
   - AC must require a comment on the new render test that names **`DEFAULT_WRITE_STEP_RULES`** (not `expect(...)` literals) as the inversion target.
   - Verification outcome: removing or inverting the guard-inversion paragraph in that constant makes `write.test.ts` RED.
   - Drop wording that sounds like flipping pinned substrings inside the test assertions—that does not prove the constant is guarded.

4. **Strengthen acceptance criterion #1 per failing-test guidance**
   - Name the specific new or extended `write.test.ts` case(s) that fail pre-change and pass after.
   - Outcome should require separate substring pins for source-mutation + comment-checkpoint evidence and each forbidden hook shape—not wholesale `toContain(DEFAULT_WRITE_STEP_RULES)` alone.

5. **Extend acceptance criterion #3 for `shared/**` blast radius**
   - Touching `DEFAULT_WRITE_STEP_RULES` changes v1 `patch.prompt.body` render output; AC must require v1 verification (e.g. `bun run test:v1` or `v1/test/prompts/rendered-snapshots.test.ts` green), not scoped v2 tests only.

6. **Add a documentation acceptance criterion**
   - `v2/docs/test-writing.md` must document source-mutation + comment-checkpoint guard-inversion evidence and forbid all four production invert-hook shapes.
   - Docs are part of the work per spec guidance; without an AC they can be skipped while code boxes are ticked.

7. **Clarify v1 fixture task obligations**
   - Tasks must state that when constant bytes change, v1 `patch.prompt.body` fixture content must be regenerated and tests must pass.
   - Distinguish regenerating rendered fixture content from bumping template `@rN` revision (revision bump only when `prompts/**` template bytes change).

## Rationale

The intent deliberately bounds work to one shared constant plus render coverage, but the draft leaves implementers to infer which plan/implement paths are in scope, what “comment checkpoint” means in AC #2, and whether v1 snapshot failure blocks completion. Spec guidance requires agent-verifiable ACs that name failing tests for behavior changes, treat documentation as deliverable work, and reflect the full test surface when `shared/**` changes. Without these refinements, an agent can merge prompt text and v2 pins while leaving v1 snapshots red, skipping operator docs, or satisfying AC #2 by inverting test literals instead of the constant—the exact evasion this spec exists to prevent.

## Not required (acknowledged, no spec change needed)

- Splitting the single subspec—it remains atomic at one coupled seam.
- `v2/docs/v1-behaviors.md`—additive prompt guidance, not a v1↔v2 behavior parity change.
- Aligning intent problem prose to four hook shapes—cosmetic; subspec and ACs are already authoritative.
- Mandatory preservation AC for terminal-token `endsWith` assertions—desirable but not blocking if existing `write.test.ts` cases are left intact per tasks.