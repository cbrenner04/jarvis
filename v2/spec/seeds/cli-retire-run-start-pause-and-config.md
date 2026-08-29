---
name: cli-retire-run-start-pause-and-config
---

# Retire the ad-hoc run primitives: `run pause`, then `run start`, then `config`

## Problem

With all real work on workflows/pipelines, the ad-hoc write-loop lane is vestigial but structurally load-bearing (2026-08-29 CLI inventory): `run start` is the only producer of `activeRuns` rows with `kind: "write-loop"` + `pauseController` (`daemon.ts:1113-1114`) and of `queuedInput`-backed resume (`daemon.ts:614`); `run pause` only acts on those rows, has one runbook mention, and its resume side is advertised unsupported (`run-operator-error.ts:306`) while `daemon.ts:614` implements it — a live code/message contradiction. `config` has no internal caller and is superseded by `init` for bootstrap; `install-and-config.md:22` uses `config path` as the smoke check. `run dismiss/undismiss` and `pipeline dismiss/undismiss` are near-identical implementations landed a day apart (`run.ts:359-422` vs `pipeline.ts:595-622`).

## Decisions

- Sequence: delete `run pause` (+ TUI `pause` verb + `pauseController` plumbing in `daemon.ts`/`write-loop.ts`), then `run start` (+ `queuedInput`, `reconstructDirectWriteResume`, `kind: "write-loop"` rows, `parseWriteCliInput`, help-parity entries), then `config` (fold `set-agents` into `init` or document hand-edit; re-point the install smoke check at `jarvis help`). Rules out deleting `run start` first and stranding pause plumbing.
- `run.test.ts`'s daemon-auto-start / stale-dispatch coverage migrates onto `run workflow` argv before the `run start` cut; no coverage dropped. Rules out losing the auto-start pins with the command.
- The dismiss pairs merge onto one implementation with two thin CLI surfaces (both verbs stay; the duplicated mutation-checkpoint idiom goes). Rules out carrying two copies of dismissal.
- Keep: `daemon start|status|stop` (runtime-smoke verifier shells them), `run list|log|wait|kill|resume` (documented recovery verbs; `run kill` is the only abort for a live pipeline stage run). Rules out over-trimming the operator's recovery surface.

## Acceptance criteria

- [ ] `run pause` and the TUI pause verb are gone; no `pauseController` remains, pinned by tests and grep-level absence.
- [ ] `run start` is gone; the migrated auto-start/stale-dispatch tests pass against `run workflow`, pinned by the moved tests.
- [ ] `config` is gone; agent-order editing has a documented home; the install smoke check works, pinned by docs + CLI tests.
- [ ] One dismissal implementation serves both `run` and `pipeline` dismiss/undismiss, pinned by existing dismiss tests re-pointed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — the `run start` pause/resume demo section is removed or rewritten around workflows.
- `v2/docs/install-and-config.md`, `v2/docs/operator-runbook.md`, `v2/docs/write-behavior.md` — command-surface updates per cut.
- `v2/docs/v1-behaviors.md` — record each retired surface.
