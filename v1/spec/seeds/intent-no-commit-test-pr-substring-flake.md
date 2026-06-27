# Flaky test: `not.toContain("PR")` collides with random tmpdir

## Problem

`v1/test/intent-command.sandbox-unrunnable.test.ts:1432` asserts a no-commit
intent run's stderr does **not** mention a PR:

```ts
expect(cap.err()).not.toContain("PR");
```

The stderr it checks is `intent: N intents written to <ready-intents-dir>`,
where the dir is a random `mkdtemp` path. When that random suffix happens to
contain the substring `PR` (case-sensitive), the assertion fails — observed in
CI 2026-06-27 with tmpdir `/tmp/jarvis-intent-YKcYPR/…`. The test is sound in
intent (no-commit mode must not open a PR or print a PR URL) but the matcher is
too broad: it greps the whole stderr, including the path, for a 2-char
substring.

## Decisions

- Tighten the assertion to a PR-specific phrase the harness actually emits
  (e.g. `not.toContain("draft PR")` / `not.toContain("PR opened")`), not the
  bare `"PR"`. Confirm the real PR-path messages and match those.
- Audit the sibling `not.toContain("warning")` and `not.toContain("https://example.com")`
  assertions in the same block for the same random-path collision risk.
- Prefer fixing the matcher over making tmpdir deterministic — other tests rely
  on unique tmpdirs.

## Documentation updates

- None expected (test-only fix); note in the subspec if behavior assertions move.
