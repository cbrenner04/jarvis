# Static guard rejects production invert-for-test hooks

## Prerequisites

- **Write-step rules** (`write-step-rules-forbid-production-invert-hooks` merged): comment-checkpoint guard-inversion contract and invert-hook prohibition in `shared/prompts/step-rules.ts` and `v2/docs/test-writing.md`.
- **Shared, CLI, daemon, execution-loop/TUI** invert-hook removal specs merged; production modules under `v2/src/**`, `v1/src/**`, and `shared/**` (excluding `*.test.ts` and `*.test.tsx`) carry no `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, or `invert*ForTest` type member.
- **Ordering:** this spec lands **last** in the mutant-fix chain (`implement-queue.md`); do not implement until every hook-removal sibling is merged — residual forbidden shapes fail `bun run check`.

- [ ] [00 - Guard production invert-for-test hooks](./00-guard-production-test-flags.md)
