# Harden No-Commit Assertions

## Problem

`intent` no-commit auto-ready coverage rejects bare `PR` in stderr. Stderr can include random filesystem paths, so an incidental `PR` in a temp path can fail the test without forbidden PR behavior.

## Decisions

- Match PR-specific stderr phrases; rules out bare substring matching across random paths.
- Keep random temp paths; rules out deterministic paths that hide isolation bugs.
- Audit sibling negative assertions in the same block; rules out leaving equivalent random-path flakes.

## Tasks

- Narrow the no-commit auto-ready stderr PR negative assertion to PR-specific output.
- Confirm or narrow the sibling `warning` and `https://example.com` negative assertions in the same no-commit block.
- Run the targeted intent command test file.

## Acceptance criteria

- [ ] `v1/test/intent-command.sandbox-unrunnable.test.ts` no-commit auto-ready coverage fails only for PR-specific forbidden output, not incidental `PR` in filesystem paths.
- [ ] The same no-commit assertion block has no remaining negative matcher that can plausibly collide with random temp path output.
- [ ] `bun test v1/test/intent-command.sandbox-unrunnable.test.ts` passes.

## Documentation updates

None. Test-only assertion hardening; no operator-facing behavior changes.
