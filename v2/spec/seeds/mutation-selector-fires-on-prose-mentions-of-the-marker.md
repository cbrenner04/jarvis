---
name: mutation-selector-fires-on-prose-mentions-of-the-marker
---

# Selecting on a bare `@mutate` substring makes every spec about the verifier fail its own gate

## Problem

PR #2518 broadened mutation-checkpoint selection to `CRITERION_MARKER || DIRECTIVE_MARKER`, where
`DIRECTIVE_MARKER` is the bare string `@mutate`. Selection is a substring test, so a criterion that
merely *names* the marker in prose is treated as a mutation-checkpoint claim and then refused as
hollow for having no linked directive.

Demonstrated on #2518's own spec: running the shipped verifier over
`20260802T045701Z-verify-directive-only-mutation-criteria/00-…md` reports `hollow: 2, caught: 0`,
and both hollow entries are meta criteria that describe the contract rather than assert one:

- *"proves a ticked criterion selected by the literal `@mutate` marker but linking no directive is
  classified hollow"*
- *"proves criteria containing the literal `@mutate` marker remain ignored when unticked or
  human-only"*

Any future spec about this subsystem trips its own completion gate. Two adjacent amplifiers:

- `linkDirectivesToCriterion` falls back to **every** directive in the file when no pin title
  matches, so a criterion that merely names a test file inherits directives it never claimed.
- `parseMutateDirectives` treats any line containing `@mutate` as a directive candidate; the
  verifier's own test file produced **52** unparseable entries, drowning the operator report.

## Decisions

- Select on a directive-**shaped** occurrence — `@mutate` followed by a path and the quoted
  `"<old>" -> "<new>"` form — not a bare substring; the existing `DIRECTIVE_PATTERN` already
  encodes that shape — rules out prose mentions selecting a criterion, without narrowing back to
  the phrase-only selector #2518 fixed.
- Drop the all-directives-in-file fallback in `linkDirectivesToCriterion`: a criterion with no
  resolvable pin is reported unresolved, not silently assigned every directive in the file — rules
  out inherited claims.
- Restrict unparseable reporting to lines that look like a directive attempt (comment-leading
  `@mutate`), so ordinary string literals mentioning the marker are not reported — rules out a
  report the operator learns to ignore.
- Out of scope: the phrase path, directive syntax, and the scoped-run lifecycle.

## Acceptance criteria

- [ ] A ticked criterion whose text names `@mutate` in prose, with no directive-shaped occurrence,
      is ignored — no hollow entry; a regression fails against the bare-substring selector.
- [ ] A ticked criterion quoting a full directive-shaped `@mutate` occurrence is still selected and
      still verified end to end.
- [ ] A criterion whose pin title resolves to no test in the linked file is reported unresolved and
      inherits no directives; a regression covers the previous all-directives fallback.
- [ ] Running the verifier over a subspec whose prose discusses `@mutate` (use
      `v2/spec/completed/20260802T045701Z-verify-directive-only-mutation-criteria/00-…md` or an
      equivalent fixture) reports zero hollow entries.
- [ ] String literals containing `@mutate` in a pinning test file produce no unparseable entries.
- [ ] Mutation checkpoint: reverting selection to the bare-substring test turns the prose-mention
      test RED, via a `// @mutate` directive in the pinning file.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — selection requires a directive-shaped occurrence.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — same, for spec authors.

## Prerequisites

- `verifyMutationCheckpoints`, `DIRECTIVE_MARKER`, `DIRECTIVE_PATTERN`, `parseMutateDirectives`,
  `linkDirectivesToCriterion` (`v2/src/execution/mutation-checkpoint-verifier.ts`)
