# Relocate preload test and fix stale layout citations

Pivot from intent: the intent assumed `cli.ts`/`cli.test.ts` need to move with
`bin/jarvis` updated in lockstep. Current state already satisfies the
Entrypoints policy, so that move is moot (see Decisions). The only file move
this subspec performs is relocating the flat-root straggler
`preload.sandbox-unrunnable.test.ts` into `v2/src/testing/` per the Source
layout domain map; the rest fixes doc citations left stale by prior
relocations and by this move.

## Decisions

- Intent's CLI-move decisions ("move `cli.ts`/`cli.test.ts`, update
  `bin/jarvis` in lockstep") are moot: current state already satisfies the
  Entrypoints policy in `v2-architecture.md` §Entrypoints ("Pinned at
  `v2/src/` root; relocate only with every caller in the same change set.
  `bin/jarvis` → `../v2/src/cli.ts`"). Evidence: `bin/jarvis` already execs
  `$script_dir/../v2/src/cli.ts`, and `cli.ts`/`cli.test.ts` already sit at
  `v2/src/` root — no move, no `bin/jarvis` edit — rules out performing a
  no-op relocation the intent assumed was still needed.
- `daemon-entrypoint.ts` stays at `v2/src/` root, not the daemon domain
  directory, per `v2-architecture.md` §Entrypoints ("`daemon-lifecycle` spawns
  `resolve(import.meta.dir, "../daemon-entrypoint.ts")`") and the domain-map
  Daemon host row's explicit carve-out ("`daemon-entrypoint.ts` remains at
  root per Entrypoints policy") — rules out relocating a pinned spawn-target
  entrypoint into the daemon domain despite the intent's prerequisite that
  daemon-host modules live there.
- Move only `preload.sandbox-unrunnable.test.ts` — rules out an unnecessary
  CLI-host move.
- Update `test/test-slices.test.ts`'s two hardcoded references to the new
  `v2/src/testing/preload.sandbox-unrunnable.test.ts` path — rules out a
  harness slice/test command that silently stops covering the file.
- Stale `write.ts`/`write-loop.ts` doc citations are out of scope here (a
  leftover from the earlier execution-domain relocation, outside this
  intent's CLI-module citation scope) — tracked in a separate subspec.

## Task checklist

- [ ] `git mv v2/src/preload.sandbox-unrunnable.test.ts v2/src/testing/preload.sandbox-unrunnable.test.ts`.
- [ ] Update any relative imports inside the moved file for the new directory depth (file currently has no relative imports to other `v2/src` modules — confirm this still holds post-move and fix any that appear).
- [ ] Update the two hardcoded path references in `test/test-slices.test.ts` (slice file list and the scoped `bun test` invocation) to the new path.
- [ ] `v2/docs/v2-architecture.md`: drop the now-stale "(root today; harness `test/test-slices.test.ts` hardcodes path — co-update on move)" annotation from the Test support domain-map row.
- [ ] Confirm `v2/docs/write-behavior.md`'s CLI-module citations (`v2/src/cli.test.ts`) are already correct — no change needed.

## Acceptance criteria

- [x] `v2/src/preload.sandbox-unrunnable.test.ts` no longer exists; `v2/src/testing/preload.sandbox-unrunnable.test.ts` exists, has no unresolved relative imports, and passes standalone (`bun test ./v2/src/testing/preload.sandbox-unrunnable.test.ts`).
- [x] `test/test-slices.test.ts` stays green (behavior unchanged by the move).
- [x] `v2/src/` root contains only `cli.ts`, `cli.test.ts`, `daemon-entrypoint.ts`, `ipc/`, and `testing/` (no other files or directories).

## Documentation updates

- `v2/docs/v2-architecture.md` — drop the stale "(root today...)" annotation on the Test support domain-map row now that the move is done.
- `v2/docs/write-behavior.md` — verified already correct; no edit required.
