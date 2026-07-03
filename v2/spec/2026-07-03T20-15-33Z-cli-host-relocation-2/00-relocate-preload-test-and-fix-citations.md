# Relocate preload test and fix stale layout citations

`cli.ts`/`cli.test.ts` already sit at `v2/src/` root and `bin/jarvis` already
points at `../v2/src/cli.ts` — both already match the Entrypoints policy, so
no CLI-host move is needed. The one remaining flat-root straggler is
`preload.sandbox-unrunnable.test.ts`, which the Source layout domain map
already assigns to `v2/src/testing/`. Relocating it is the only file move
this subspec performs; the rest is fixing doc citations left stale by prior
relocations (execution/persistence/daemon/tui) and by this move.

## Decisions

- Move only `preload.sandbox-unrunnable.test.ts`; `cli.ts`, `cli.test.ts`, and
  `daemon-entrypoint.ts` stay at root per the Entrypoints policy — rules out
  an unnecessary CLI-host move.
- Update `test/test-slices.test.ts`'s two hardcoded references to the new
  `v2/src/testing/preload.sandbox-unrunnable.test.ts` path — rules out a
  harness slice/test command that silently stops covering the file.

## Task checklist

- [ ] `git mv v2/src/preload.sandbox-unrunnable.test.ts v2/src/testing/preload.sandbox-unrunnable.test.ts`.
- [ ] Update the two hardcoded path references in `test/test-slices.test.ts` (slice file list and the scoped `bun test` invocation) to the new path.
- [ ] `v2/docs/v2-architecture.md`: drop the now-stale "(root today; harness `test/test-slices.test.ts` hardcodes path — co-update on move)" annotation from the Test support domain-map row.
- [ ] `v2/docs/v1-behaviors.md`: fix the two `Sources:` citations that still say `v2/src/write.ts` / `v2/src/write-loop.ts` to `v2/src/execution/write.ts` / `v2/src/execution/write-loop.ts`.
- [ ] Confirm `v2/docs/write-behavior.md`'s CLI-module citations (`v2/src/cli.test.ts`) are already correct — no change needed.

## Acceptance criteria

- [ ] `v2/src/preload.sandbox-unrunnable.test.ts` no longer exists; `v2/src/testing/preload.sandbox-unrunnable.test.ts` exists and passes standalone (`bun test ./v2/src/testing/preload.sandbox-unrunnable.test.ts`).
- [ ] `test/test-slices.test.ts` stays green (behavior unchanged by the move).
- [ ] `v2/src/` root contains only `cli.ts`, `cli.test.ts`, `daemon-entrypoint.ts`, `ipc/`, and `testing/` (no other files or directories).
- [ ] No committed doc under `v2/docs/` cites `v2/src/write.ts` or `v2/src/write-loop.ts` (without the `execution/` segment).

## Documentation updates

- `v2/docs/v2-architecture.md` — drop the stale "(root today...)" annotation on the Test support domain-map row now that the move is done.
- `v2/docs/v1-behaviors.md` — repoint `Sources:` citations for `write.ts`/`write-loop.ts` to their `execution/` paths.
- `v2/docs/write-behavior.md` — verified already correct; no edit required.
