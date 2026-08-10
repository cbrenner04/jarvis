## Verdict — refinement required

Verified against `shared/mutation-checkpoint-criteria.ts`, `shared/module-boundary-surfaces.ts`, `v2/src/execution/write.ts:141-148`, `v1/src/modes/plan/draft.ts:348-361`.

### 1. Correct the stated failure mode (Problem section, and the AC that leans on it)
Keystone selection (`isKeystoneCheckpointBlock`) requires the canonical suffix *and* a test-file reference; a prose-only keystone is selected by neither keystone nor guard selection, and `keystoneUnlinked` only reports criteria that were selected. So a prose-only keystone today produces **no** `contract_miss` — it is ticked and silently never verified. The spec's Problem must state that premise (fake evidence, not a loud terminal failure). The gate's value is unchanged; the causal story is wrong as written and must not survive refinement. Note also that the intent's first prerequisite (implement authors and links the directive) is not observable on `main` at this base — say so honestly rather than restating it as established.

### 2. Collapse admissibility to one rule
Admissible must mean **selectable by keystone selection** — canonical suffix `` `pinFile` — `pinTitle`; Keystone checkpoint: `` with a test-file-shaped pin file. Drop the "or contains a literal `// @mutate` directive" alternative: a block with a directive but no canonical suffix is *also* never selected and never verified, i.e. exactly the class the gate exists to exclude; admitting it pins the hole open. State explicitly that the guard-only prefix-first shape (`Keystone checkpoint: in \`f.test.ts\` test \`t\``) is **not** admissible for keystones, so the intent's looser "backticked file plus title" wording cannot be read as permitting it. The doc-update bullet for `v1/docs/spec-guidance.md` must match this single rule (its current "must name a pin **or** carry a directive" phrasing contradicts it).

### 3. State the mechanism precisely
`selectKeystoneCheckpointCriteria` takes whole-subspec markdown, not a block, so "its block matches `selectKeystoneCheckpointCriteria`" is a misdescription. The spec must name how the gate reuses existing selection (call it on subspec content with the default unchecked-inclusive behavior, or export the block predicate) so the rule is defined once, not re-implemented.

### 4. Missing decisions that the implementation would otherwise have to invent
- **Scan scope**: only `## Acceptance criteria` blocks are candidates. Without this, a whole-file scan would refuse this very spec, whose `## Problem` quotes a prose keystone.
- **Human-only exemption**: selection skips `humanOnly`, so a `(Manual)` keystone is never verified anyway; the gate must not refuse it.
- **Code-span handling**: the guidance-sanctioned descriptive mention is written with *double* backticks (`` `Keystone checkpoint:` ``); a naive parity scan mishandles it. Name the backtick-run-aware handling, and say which form AC 3's fixture uses. Fenced code blocks are out of scope — assembled bullet blocks don't produce them.
- **v1 message prefix**: v2 forwards the thrown message verbatim as the `contract_miss` reason, but v1 wraps it as `plan boundary normalization failed: <reason>`, which misdescribes a criterion refusal. The spec updates `v1/docs/spec-guidance.md` while saying nothing about the v1 path this shared change alters. Accepting the prefix (v1 is maintenance-only) is defensible — but it must be a stated decision.
- **Scope narrowing**: the spec silently rewrote the intent's prose *guard* checkpoint example into a keystone. Excluding guards is the right call (guards have a directive-only selection path and already surface as at-risk-hollow advisories), but make it a stated decision and restore an honest example.

### 5. Coverage gaps that let a wrong implementation pass every criterion
- **Opt-in preserved**: no criterion pins that a tree with **no** keystone criterion still normalizes. Keystones are documented opt-in; an implementation that refuses "missing keystone" satisfies all seven current criteria.
- **Placement**: Decision 1's entire content is that the gate runs *before* the multi-boundary early return, and no criterion exercises a single-boundary tree. A gate placed after the return passes every current criterion and never fires on the common case. Add an explicit single-boundary-fixture criterion.

### 6. Keystone/guard overlap
AC 7's "revert the gate call to a no-op" strictly subsumes AC 5's "treat every candidate as admissible" — the keystone proves nothing the guard doesn't. Re-scope the guard to something the keystone cannot cover (the refusal *message* content: dropping the criterion text or the offending file name must turn its test red), leaving the keystone as the headline refusal.

### 7. Criterion hygiene
AC 1 says "both new tests" without naming them; the linker matches on the literal enclosing test title, so it must cite the two titles the other criteria already name. The admission-path criteria (canonical suffix admitted, backticked mention admitted, nonexistent-on-disk pin admitted) are the negative paths — name their tests too.

### Not required
No split. One shared detection helper, one call site, three doc updates is commit-sized and correctly a single subspec.