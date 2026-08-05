---
name: implement-completion-honesty
---

# Implement completion honesty: stale-worktree preflight, false-`completed` refusals, resumable timeout

One spec, ordered subspecs — **do not fan out**. Three coupled problems share `resetStaleWorkspace`
/ `maybeResetStaleWorkspace`, the write-loop `no-work` → `completed` boundary, and the daemon
`run list` / `run wait` projection. Two of them add **opposing gates to the same preflight**, whose
precedence must be decided once (preserve-before-reuse), not by whichever lands second. Problem B
(criteria-based routing) already landed via #2613 and is out of scope here.

Suggested subspec order (plan owns final split): **00** preflight gates (Problem A) → **01**
write-loop settlements (Problem C + dirty-`no-work` refusal) → **02** daemon projection on
`list`/`wait`. 02's full integration gate assumes 00 and 01 precede it in the same spec.

## Problem A — stale/dirty/landed-tick worktree reuse settles false `completed`

2026-08-03, run `eabc39a7`: `resetStaleWorkspace` reused a managed worktree whose HEAD lagged
`--base` and held uncommitted tracked paths from an `iteration_timeout` run. The write step read a
fully ticked subspec, settled `no-work` → `completed`, committed nothing. **Root cause is not
established — a reproduction lands before any fix.**

## Problem C — an iteration timeout discards completed subspec work

`iteration_timeout` settles `resumable: false` / `stop`; documented recovery re-dispatches and
retires the workspace, destroying already-finished subspecs. A timeout with at least one fully
satisfied subspec must retain branch, worktree, and iteration commits for `jarvis run resume`.

## Dirty-`no-work` refusal

A write step resolving `no-work` while its worktree holds uncommitted tracked changes must not
settle `completed`; it settles a named non-`completed` failure listing those paths.

## Decisions

- A failing regression against the stale-dirty reuse path lands before any fix — rules out patching an unproven cause.
- An implement re-run refuses when managed worktree HEAD is not a descendant of the resolved `--base`, independent of dirty state — rules out silently reusing a stale branch tip whose spec copy disagrees with base; retirement is not an alternative outcome.
- `resetStaleWorkspace` gains a **preserve gate before** the existing stale/dirty reuse gate: refuse retirement when the worktree spec tree has criteria ticked that are unticked on `--base`, naming those subspec paths; `--reset-despite-landed-criteria` proceeds. The dirty-gate override stays `--reset-despite-dirty` — rules out overloading one flag for two conditions.
- Preserve gate runs **before** the reuse refusal; a worktree that is both dirty and carrying base-absent ticks names **both** conditions — rules out implicit gate-order races. A regression pins the order.
- Descendant-check and preserve/reuse gates live only in `resetStaleWorkspace` / `maybeResetStaleWorkspace` — rules out duplicating the refusal in the write-loop router. Plan re-runs share the gates via `maybeResetStaleWorkspace`; ACs pin implement re-run.
- A write step resolving `no-work` over uncommitted tracked paths settles a named non-`completed` failure listing those paths — rules out reporting success over uncommitted work.
- `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked settles `resumable: true` / `nextAction: "resume"`; a run with no completed subspec keeps `resumable: false` / `stop` — rules out "re-dispatch and redo" as sole recovery.
- The timeout settlement carries a completion inventory naming completed and remaining subspec paths in durable loop output — rules out an opaque timeout.
- Completed-subspec `iteration_timeout` recovery is `jarvis run resume` on the retained workspace — no distinct re-entry; resume continues on the retained branch and worktree with no `resetStaleWorkspace` and no rematerialization — rules out resume paths that discard iteration commits.
- `run list` / `run wait` project the dirty-`no-work` non-`completed` status, the resumable-timeout `nextAction`, and the completion inventory from the same durable fields the write loop wrote, preserving existing `publicationFailure` and other operator-error fields — rules out CLI rows still reading `completed` and rules out message-only diagnostics.
- A run finding every subspec's criteria ticked settles `implement.already_complete` (existing tree-level contract), never `no-work`/`completed` on one fully-ticked subspec.

## Acceptance criteria

- [ ] A regression drives the implement re-run preflight against a managed worktree whose HEAD is behind the resolved base and has uncommitted tracked paths, and asserts a refusal naming those paths; it fails against the current preflight.
- [ ] A regression asserts an implement re-run refuses when the managed worktree HEAD is not a descendant of the resolved `--base`, with a clean worktree, naming base and worktree HEAD.
- [ ] `resetStaleWorkspace` refuses to retire a workspace whose managed worktree spec tree has criteria ticked that are unticked on `--base`, names those subspec paths on stderr, and changes nothing; `--reset-despite-landed-criteria` proceeds. A regression covers both.
- [ ] A worktree that is both dirty and carrying ticks absent from `--base` refuses with both conditions named — the preserve gate is checked before the reuse gate; a regression pins the order.
- [ ] A regression asserts a write step that resolves `no-work` over a worktree with uncommitted tracked paths settles a non-`completed` status naming those paths; it fails against the current boundary.
- [ ] An implement run that settles `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked reports `resumable: true` / `nextAction: "resume"` in its terminal `loop_finished` record; a run with no completed subspec keeps `resumable: false` / `stop`. Inverting the completed-subspec predicate makes the regression red.
- [ ] The `iteration_timeout` terminal loop record carries a completion inventory naming each completed subspec path and each remaining one; a test pins both lists against a tree with one complete and one incomplete subspec.
- [ ] Resuming such a run continues on the retained branch and worktree — no `resetStaleWorkspace`, no rematerialization — and the pre-existing iteration commits are still reachable from the branch head after the resume settles.
- [ ] A regression asserts `run list` and `run wait` project a dirty-`no-work` refusal as a non-`completed` row naming the uncommitted paths, report `resumable`/`nextAction` for both timeout cases, and carry the completion inventory; each fails against the current daemon mapping.
- [ ] Mutation checkpoints: `// @mutate` directives inverting the descendant check, the preserve gate, the dirty-`no-work` refusal, and the completed-subspec `iteration_timeout` resumability predicate each turn their pinning test RED. Author each checkpoint criterion single-line (pinning-test file + enclosing test name first), naming the enclosing test verbatim.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row no longer admits the `no-work`-over-dirty case; state what `no-work` now settles; `iteration_timeout` is conditionally resumable.
- `v2/docs/operator-runbook.md` § Recovery — replace the "re-dispatch the workflow" guidance for completed-subspec `iteration_timeout` with resume-from-retained-workspace guidance; document the descendant-check and preserve-before-reuse retirement refusals and `--reset-despite-landed-criteria`.
- `v2/docs/daemon-host.md` — document completion-honesty fields on `list`/`wait` operator errors and their coexistence with existing error shapes.
- `v2/docs/v1-behaviors.md` — record the descendant-check preflight, preserve-before-reuse gate, dirty `no-work` refusal, resumable `iteration_timeout`, and daemon projection of both.

## Prerequisites

- `resetStaleWorkspace` retires stale managed worktrees on implement/plan re-runs via `maybeResetStaleWorkspace`, before the write step.
- Per-iteration commit checkpointing on every settled main-loop iteration.
- Implement routes to the first subspec with unticked non-human-only acceptance criteria (Problem B, landed #2613), and a fully-ticked tree settles `implement.already_complete`.
- The write-loop completion boundary maps agent `no-work` to `runStatus: "completed"` when no dirty-worktree guard fires.
- `composeRunOperatorError` maps terminal `loop_finished` records to `run list` / `run wait` operator errors.
