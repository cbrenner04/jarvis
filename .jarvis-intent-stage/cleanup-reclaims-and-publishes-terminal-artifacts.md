---
name: cleanup-reclaims-and-publishes-terminal-artifacts
---

# Cleanup reclaims terminal artifacts without dirtying the operator checkout

## Prerequisites

- Dead keyed daemon generations expose their complete removable `.sock`, `.pid`, and `.log` set while live or ambiguously probed generations preserve the whole triplet.

## Module-boundary surface

- CLI: cleanup discovery, eligibility, retirement, archival publication, retention, and reporting in `v2/src/commands/cleanup.ts`, `v2/src/commands/cleanup-artifacts.ts`, `v2/src/commands/cleanup-cli.ts`, and machine-config loading.

## Problem

The cleanup command retains worktrees claimed only by terminal runs, fails opaquely on redundant plan-stage criteria dirt, inspects non-spec or missing paths, scopes one detached owner across unrelated specs, repeats skip lines, leaves archive moves uncommitted on the primary checkout, and never reaps settled session logs.

## Behavior

- Cleanup retires merged worktrees when no non-terminal durable row or live daemon run claims them; redundant chained-implement criteria ticks do not block a merged plan worktree's retirement, while other dirt refuses with the dirty paths named.
- Stranded discovery ignores dot-directories, harness staging directories, and paths absent at report time; ownership and detached-worktree refusals are scoped to the artifact being decided; each skipped artifact appears once per invocation.
- Completed archive moves are committed, pushed on a cleanup-owned operator branch, and proposed in one PR without changing or dirtying the primary checkout.
- Cleanup reaps `.log` files in `~/.jarvis/sessions/` only when their owning run is terminal and its durable finish time is older than the configured retention window, default 14 days; recent, live, non-terminal, and unprovable logs remain.
- `--dry-run` summarizes expired session-log count, reclaimable bytes, and oldest-kept date without listing every log, and apply reports the reclaimed summary.

## Decision ledger

- Only non-terminal durable rows or daemon-live rows retain `(project, branch)` ownership; rules out perpetual ownership by completed, failed, or killed rows.
- Force-remove a merged plan worktree only when every dirty path is criteria-tick drift already present on the merge base; rules out discarding unrelated operator changes under the redundant-tick exception.
- Refused dirty retirement names the dirty paths; rules out exposing only `Command failed: git worktree remove`.
- Exclude every dot-directory and recognized harness staging directory from spec discovery, then recheck path existence before reporting; rules out treating agent scratch state or vanished entries as artifacts.
- Key skip aggregation by canonical artifact identity and emit one final reason line; rules out duplicate output from pre-retirement and stranded passes.
- A detached or unresolved worktree blocks only an artifact it materially contains or durably identifies; rules out one worktree disabling repo-wide archival.
- Publish archive moves from an isolated cleanup-owned branch and worktree, leaving the operator checkout untouched; rules out committing on or leaving moves in the primary checkout.
- A publication failure rolls archive moves back and reports the failure; rules out silently leaving an uncommitted `D` plus `??` archive pair.
- Session-log expiry uses the owning run's durable terminal finish time, never file mtime; rules out deleting a live run's old-looking log.
- Unknown or non-terminal log ownership preserves the file; rules out age-only deletion when settlement cannot be proved.
- Session retention may touch only `.log` files directly under `~/.jarvis/sessions/`; rules out reaching `telemetry.jsonl`, `state/v2.sqlite`, nested research inputs, or unrelated Jarvis-home files.
- Default session-log retention is 14 days with one documented machine-config override; rules out an unbounded hard-coded retention policy.
- Dry-run reports aggregate log count and bytes plus the oldest-kept date; rules out flooding stdout with hundreds of thousands of filenames.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `terminal-only run claims do not retain merged worktrees` retires the worktree and archives its completed spec; it fails against the pre-fix owns-forever behavior.
- [ ] `v2/src/commands/cleanup.test.ts` test `merged plan worktree with landed criteria-only dirt retires safely` proves redundant chained-implement ticks permit retirement, while a sibling fixture with unrelated dirt is preserved and reports its paths; it fails against the pre-fix raw `git worktree remove` error.
- [ ] `v2/src/commands/cleanup.test.ts` test `stranded discovery ignores non-spec and vanished paths` produces no skip lines for dot-directories, harness staging directories, or a candidate deleted before reporting; it fails against the pre-fix inspection output.
- [ ] `v2/src/commands/cleanup.test.ts` test `detached owner blocks only its own artifact` archives an unrelated completed spec while preserving the owned spec; it fails against the pre-fix repo-wide ownership gate.
- [ ] `v2/src/commands/cleanup.test.ts` test `each skipped artifact is reported once` drives the pre-retirement and stranded passes over one identity and asserts one merged skip line; it fails against the pre-fix duplicate output.
- [ ] `v2/src/commands/cleanup.test.ts` test `archive publication leaves the primary checkout clean` proves successful archive moves land on a pushed cleanup branch with one PR and no primary-checkout diff; it fails against the pre-fix uncommitted rename.
- [ ] `v2/src/commands/cleanup.test.ts` test `archive publication failure restores the source tree` proves a failed commit, push, or PR step leaves no archive move or primary-checkout dirt and emits a named failure; it fails against the pre-fix silent dirty state.
- [ ] `v2/src/commands/cleanup.test.ts` test `session retention reaps only old terminal run logs` proves the default and configured windows remove old terminal-owned logs while preserving recent, live, non-terminal, and unknown-owner logs; it fails against the pre-fix no-reap behavior.
- [ ] A session-retention guard fixture proves cleanup touches only direct `.log` children of `~/.jarvis/sessions/` and preserves `telemetry.jsonl`, `state/v2.sqlite`, and files outside that directory.
- [ ] `--dry-run` reports expired session-log count, bytes, and oldest-kept date without filenames and performs no mutation.
- [ ] Cleanup consumes the prerequisite daemon triplet classification so one invocation previews and applies all dead daemon companion removals.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — terminal-claim reclamation, redundant criteria-dirt retirement and refusal paths, artifact filtering/deduplication, spec-scoped ownership, archive publication, session-log retention and exclusions, summaries, and daemon companion integration.
- `v2/docs/install-and-config.md` — session-log retention setting and 14-day default.
- `v2/docs/v1-behaviors.md` — record the changed v2 cleanup behavior and v1 divergence.

## Primary implementation surface

v2/src/commands/cleanup.ts
