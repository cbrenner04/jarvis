# Pin the v2 ready gate to the full tier

`defaultRunReadyGate` in `v2/src/execution/ready-finalize.ts` spawns `bun run ready` without an
env, so the child inherits `JARVIS_READY_TIER` from the parent. `scripts/ready.ts`'s
`parseReadyTier` defaults to `full` only when the var is unset; an inherited `fast` silently
downgrades the gate to typecheck + tests, skipping `check` and `lint:md`. Result: a run reports
`completed` and flips the PR to ready on a tree CI rejects for format/lint (run `3c9536a9`,
PR #1484).

The gate must run `full` unconditionally: format/lint regressions fail the gate, the run does not
report `completed`, and the draft PR stays draft.

## Decisions

- `defaultRunReadyGate` passes an explicit child env of `{ ...process.env, JARVIS_READY_TIER: "full" }` — an override, not a `??` default; rules out leaving an inherited `fast` in place.
- `parseReadyTier` in `scripts/ready.ts` is unchanged; other callers rely on ambient/unset behavior.
- `AsyncSubprocessOptions` in `shared/subprocess.ts` gains an optional `env` passed straight to `execFile`; omitted `env` keeps today's full inheritance. Rules out a v2-local `spawn` bypassing the shared runner seam.
- Gate failure keeps `ready_finalize_failed`; no lint-specific outcome kind.

## Task checklist

- [ ] Add `env?: NodeJS.ProcessEnv` to `AsyncSubprocessOptions` and thread it through `realAsyncSubprocessRunner.runAsync`.
- [ ] Set `JARVIS_READY_TIER: "full"` on the `bun run ready` spawn in `defaultRunReadyGate`.
- [ ] Tests: shared runner honors `env`; `defaultRunReadyGate` overrides an inherited `JARVIS_READY_TIER=fast`.
- [ ] Docs.

## Acceptance criteria

- [ ] A v2 implement run whose commit introduces a format or markdown-lint regression fails the ready gate (`ready_finalize_failed`), does not report `completed`, and leaves the draft PR draft — even when the invoking process has `JARVIS_READY_TIER=fast` in its environment.
- [ ] `shared/subprocess.ts`'s `runAsync` accepts an `env` option and passes it to the child process; omitting it preserves today's inherited-env behavior.
- [ ] `v2/src/execution/ready-finalize.test.ts` covers the override: with `JARVIS_READY_TIER=fast` in `process.env`, the gate spawn's child env carries `JARVIS_READY_TIER=full`.
- [ ] `bun run ready` invoked from a v2 run runs `check`, `typecheck`, tests, and `lint:md`.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust and § Implementation on jarvis specs — v2's gate covers check/lint/format; drop the "run `bun run ready` yourself after a v2 implement run" stopgap.
- `v2/docs/write-behavior.md` — state that the ready gate runs the `full` tier regardless of ambient `JARVIS_READY_TIER`.
- No `v2/docs/v1-behaviors.md` change: this alters v2 gate behavior only; the v1 catalog's ready-gate entries are unaffected.
