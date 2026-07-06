---
name: remove-unreferenced-v2-files
---

# Remove unreferenced v2 source and fixture files

Pure deletion of files with zero production or test references: `v2/src/tui/tui-field-collector.tsx` and its test (future TUI workflow launcher rebuilds when needed); `v2/test/fixtures/complexity-violation.ts` and `shared-import-violation.ts` (adjust fixtures README if it names them). No replacements or new helpers.

## Decisions

- Delete `tui-field-collector.tsx` and co-located test — rules out stubbing or relocating to another module.
- Delete unused fixture files and update `v2/test/fixtures/README.md` — rules out keeping orphan fixture docs.
- No TUI workflow launcher replacement in this slice — rules out rebuilding field collection ahead of a real consumer.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Documentation updates

- `v2/docs/v2-architecture.md` — TUI domain map drops `tui-field-collector.tsx` and its test
- `v2/docs/v1-behaviors.md` — remove or revise launch field-collection entry if it references deleted module
- `v2/docs/write-behavior.md` — only if it references `tui-field-collector.test.tsx`

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
