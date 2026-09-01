---
name: exclude-test-support-from-production-glob
---

# Exclude test-support files from the v2 production source glob

`workflow-runner.test-support.ts` and other `*.test-support.ts` files live under `v2/src/` and are scanned as production modules today, so support code can be imported from shippable modules without an obvious boundary violation.

## Primary implementation surface

- `v2/tsconfig.json` and shared production-file predicates in `scripts/guard-*.ts`

## Behavior

- `*.test-support.ts` under `v2/src` is excluded from the production source glob used for typecheck and structural `bun run check` guards.
- A structural guard fails when any production module under `v2/src` imports a `*.test-support.ts` file.

## Decision ledger

- Exclude `*.test-support.ts` via tsconfig and align every existing production-file predicate on the same suffix rule; rules out leaving test-support in one glob while another guard still treats it as shippable.
- Fail on production imports of test-support rather than only hiding the files from scans; rules out silent production coupling that a glob-only change would miss.

## Acceptance criteria

- [ ] A regression test in `scripts/guard-production-test-support-imports.test.ts` fails when a production file imports `*.test-support.ts` and passes on the swept tree.
- [ ] `v2/tsconfig.json` (or the production typecheck project it defines) excludes `*.test-support.ts` from the production compilation glob, pinned by a test or guard self-check.
- [ ] `scripts/guard-sync-child-processes.test.ts` and other guard tests that reference `workflow-runner.test-support.ts` stay green with the unified exclusion rule.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — append test-support file placement and production-glob exclusion (preserve prior intent sections).

## Prerequisites
