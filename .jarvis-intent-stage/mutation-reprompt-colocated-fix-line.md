---
name: mutation-reprompt-colocated-fix-line
---

# Mutation reprompts name the co-located killing-test path per survivor kind

## Problem

For `importer-discovery-cap-exceeded` and `missing-killing-test`, `write.surviving-mutation-reprompt` and `write.mutation-repair` tell the agent to fix co-located coverage without naming `<dir>/<stem>.test.ts` or stating that importer-only tests elsewhere do not satisfy the verifier.

## Decisions

- Add a rendered per-kind fix line (new placeholder or equivalent) for those two mutation ids only; other kinds keep current copy.
- Derive the path from the surviving production `SOURCE_FILE` using the same co-located stem rule as the diff-derived mutation verifier.

## Acceptance criteria

- [ ] `write-prompt.test.ts` (or sibling template render tests) assert rendered `write.surviving-mutation-reprompt` and `write.mutation-repair` for `importer-discovery-cap-exceeded` on production path `v2/src/execution/foo.ts` contain `v2/src/execution/foo.test.ts` and state non-co-located importer tests do not count; fails against the pre-fix templates.

## Documentation updates

- `v2/docs/write-behavior.md` — per-kind reprompt fix line for importer-cap and missing-killing-test survivors.

## Prerequisites
