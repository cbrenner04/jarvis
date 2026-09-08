# Align test-writing forbidden seams

`v2/docs/test-writing.md` still lists only the four invert-for-test hook shapes under static enforcement while the guard now covers generalized `ForTest`/`ForTests` seams.

## Decisions

- Align the forbidden production test-seam bullet with the six shape families enforced by `scripts/guard-production-test-flags.ts` — rules out test-writing guidance that understates guard scope.
- Keep the guard-inversion evidence contract unchanged — rules out coupling doc alignment to checkpoint-authoring edits.

## Tasks

- Update the **Forbidden production invert hooks** subsection in `v2/docs/test-writing.md` to list the generalized guard shapes and retain the `bun run check` / `scripts/guard-production-test-flags.ts` citation.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` — forbidden production test-seam list matches the six shape families enforced by `scripts/guard-production-test-flags.ts`.

## Documentation updates

- `v2/docs/test-writing.md` — covered by the acceptance criterion above.
