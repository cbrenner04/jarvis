# Fix stale write.ts/write-loop.ts citations in v1-behaviors.md

Leftover from the earlier execution-domain relocation: `v2/docs/v1-behaviors.md`
still cites `v2/src/write.ts` / `v2/src/write-loop.ts` without the `execution/`
segment. Out of scope for subspec 00 (CLI-module citations only); fixed here
as its own atomic change.

## Decisions

- Fix only the `Sources:` citations naming `write.ts`/`write-loop.ts` — rules
  out bundling unrelated citation cleanup into this pass.

## Task checklist

- [ ] `v2/docs/v1-behaviors.md`: fix the `Sources:` citations that still say `v2/src/write.ts` / `v2/src/write-loop.ts` to `v2/src/execution/write.ts` / `v2/src/execution/write-loop.ts`.

## Acceptance criteria

- [x] `v2/docs/v1-behaviors.md` cites `v2/src/execution/write.ts` and `v2/src/execution/write-loop.ts`, not the unqualified root paths.

## Documentation updates

- `v2/docs/v1-behaviors.md` — repoint `Sources:` citations for `write.ts`/`write-loop.ts` to their `execution/` paths.
