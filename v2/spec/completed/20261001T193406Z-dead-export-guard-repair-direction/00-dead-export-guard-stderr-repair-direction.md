# 00 - Dead-export guard stderr repair direction

## Problem

`scripts/guard-dead-exports.ts` prints only `<file>:<line>: unreferenced export <Name>` on stderr (`import.meta.main` loop at line 174). Ready-gate repair agents satisfy the guard by adding imports from paths outside the attributable repair fence instead of demoting or deleting the export.

## Decisions

- Each stderr finding appends `(demote to module-private if used in-file, else delete; never add an import to satisfy the guard)` immediately after the export name — rules out leaving message-only output that invites cross-file imports.
- The `<file>:<line>: unreferenced export <Name>` prefix stays byte-for-byte before the parenthetical — rules out a new format agents cannot grep or parse from prior runs.
- Detection (`findDeadExports`, allowlist, reference scan) is unchanged — rules out coupling message work to graph logic.
- One shared formatter produces the full line for both stderr and unit tests — rules out duplicating the suffix string in tests only.
- A CLI-main test (subprocess or equivalent) asserts stderr includes the parenthetical — rules out formatter-only coverage while the `import.meta.main` loop still emits the pre-fix template.

## Tasks

- Add `deadExportDiagnostic(entry: DeadExport): string` (or equivalent) in `scripts/guard-dead-exports.ts`; use it from the `import.meta.main` stderr loop.
- Extend `scripts/guard-dead-exports.test.ts` with a formatter case built from an in-file-only dead export (same shape as the existing `LIMIT` / `bounded` fixture): assert the diagnostic matches the new suffix and retains `<file>:<line>:`; assert the pre-fix message-only line would fail.
- Add a CLI-main test in `scripts/guard-dead-exports.test.ts` that runs the script as main against a fixture tree with a known dead export and asserts stderr contains the full diagnostic including the parenthetical; assert it fails against pre-fix when the stderr loop still uses the message-only template.
- Update `v2/docs/coding-standards.md` § Export hygiene gate: document the full stderr line including the parenthetical.

## Acceptance criteria

- [x] `scripts/guard-dead-exports.test.ts` dead-export diagnostic formatter test: an in-file-only export yields `<file>:<line>: unreferenced export <Name> (demote to module-private if used in-file, else delete; never add an import to satisfy the guard)` with the `<file>:<line>:` prefix intact; fails against the pre-fix message-only line.
- [x] `scripts/guard-dead-exports.test.ts` CLI-main stderr test: running `scripts/guard-dead-exports.ts` as main against a constructible dead-export fixture prints stderr containing that full line including the parenthetical; fails against pre-fix when the `import.meta.main` loop at `scripts/guard-dead-exports.ts` still uses the message-only template.
- [x] `scripts/guard-dead-exports.test.ts` `describe("dead-export gate")` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/coding-standards.md` — document the full guard stderr line format in § Export hygiene gate.
