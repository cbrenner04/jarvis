# Align coding-standards test-seam section

`v2/docs/coding-standards.md` still says other `*ForTest` hooks remain out of scope while `scripts/guard-production-test-flags.ts` is broadening to generalized `ForTest`/`ForTests` shapes.

## Decisions

- Replace the invert-only four-shape list with the six shape families enforced by the broadened guard — rules out docs that still claim only `invert*` hooks are forbidden.
- Keep the three scan roots (`v2/src`, `v1/src`, `shared`) and `bun run check` wiring citation — rules out narrowing docs to v2-only enforcement.
- Non-`set*` `ForTest`-suffixed exports remain explicitly out of scope in prose — rules out implying the guard bans every `*ForTest` export.

## Tasks

- Update the **Production invert-for-test hooks** section (rename only if the heading no longer fits) in `v2/docs/coding-standards.md` to list the six generalized shape families enforced by the guard; cite `scripts/guard-production-test-flags.ts`.

## Acceptance criteria

- [ ] `v2/docs/coding-standards.md` — production test-seam prohibition matches the six shape families enforced by `scripts/guard-production-test-flags.ts` and names all three scan roots.

## Documentation updates

- `v2/docs/coding-standards.md` — covered by the acceptance criterion above.
