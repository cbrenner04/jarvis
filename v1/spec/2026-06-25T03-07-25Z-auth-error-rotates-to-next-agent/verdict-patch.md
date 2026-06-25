# Verdict

## Required outcomes

1. **Resolve the replace-vs-add contradiction in `v1/docs/quota-signals.md`.** The grep-contract section currently states both that the auth-rotation note appears *instead of* quota phrasing and *in addition to* the per-agent rotation line. These contradict. The shipped behavior is replace-semantics (one rotation line per event: the auth note on an auth rotation, the quota line otherwise). The doc must describe exactly that, consistently, so an operator knows whether to grep for one line or two. Doc-only fix.

2. **Add regression coverage for the shrink and review auth-note branches.** Subspec 01 AC #1 enumerates five rotation paths (patch run, shrink, review, prompt, plan) and the checklist claims coverage across them, but the `authFailure` branches in `shrink.ts` and `review.ts` ship with no test. Either add a minimal test asserting each emits the agent-named auth note on auth rotation and the plain quota line otherwise, or these two of five named paths remain unguarded while the AC is ticked. Add the tests — the AC text cannot be narrowed (spec tree is immutable here), so coverage must match the claim.

3. **Make the auth-rotation note string share no substring with transient phrasing.** Decision in subspec 01 requires the note share *no substring* with quota/transient wording; the current string contains `retry`, which overlaps the transient-retry line (`retrying same agent`). Reword the constant in `v1/src/quota-harness-messages.ts` (e.g. drop "and retry") so the grep substring is genuinely disjoint. Low effort, required for spec fidelity since the distinct-substring property is the note's contract.

## Low priority (note, not blocking)

- **Zero-exit auth no-op.** Classification keys on a non-zero exit; an exit-0 CLI emitting revoked-token stderr would return `kind: "ok"` and not rotate. This is within the spec's stated stderr-driven, exit-code-unconfirmed scope, but the residual risk (feature no-ops if the real sample exits 0) is worth a one-line known-limitation note in `quota-signals.md`.

## Rationale

The core architecture (routing auth through the quota path, codex-scoped durable patterns, no bare `401`/`unauthorized`, `transient → auth → model_config → quota` precedence, optional `authFailure` marker) is sound and verified — no behavioral defects. The upheld items are documentation accuracy (1), test/AC alignment against the spec's own five-path thesis (2), and a contract property the spec explicitly committed (3). All three are necessary for the implementation to actually match what the spec promised an operator and a future maintainer.