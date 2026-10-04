# 02 - Align docs and prompt with enforced shapes

## Problem

`v2/docs/coding-standards.md`, `v2/docs/test-writing.md`, and `shared/prompts/step-rules.ts` describe six enforced shape families that the guard did not detect until `00`, and omit the exported `*ForTest` helper shape `00` adds.

## Decisions

- Docs and the write-step prohibition line describe exactly the shipped structural enforcement: type members, parameters, module variables, and exported functions or variables named `*ForTest`/`*ForTests` (plus `invert*` parameters), verified by an AST pass and a run-time meta-test; rules out a prompt or doc that overclaims relative to shipped behavior.
- The v1-behaviors baseline records the widened enforcement as a v2-only harness gate; rules out silent baseline rot.

## Tasks

- Update `v2/docs/coding-standards.md` § Production test seams and `v2/docs/test-writing.md` forbidden-seams bullet; state that the guard is verified against real source.
- Update the prohibition line in `shared/prompts/step-rules.ts` and its pins in `v2/src/execution/write.test.ts` and any rendered prompt fixtures.
- Add a `v2/docs/v1-behaviors.md` entry.

## Acceptance criteria

- [x] `v2/docs/coding-standards.md` and `v2/docs/test-writing.md` list the enforced shapes including exported `*ForTest` helpers and name the real-source verification.
- [x] `shared/prompts/step-rules.ts` prohibition line matches the enforced shapes and `v2/src/execution/write.test.ts` pins it.
- [x] `v2/docs/v1-behaviors.md` records the widened structural enforcement.
- [x] `bun run lint:md`, `bun run typecheck`, and `bun run test:v2` pass.

## Documentation updates

- Covered by the acceptance criteria above.
