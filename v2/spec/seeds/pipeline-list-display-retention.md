---
name: pipeline-list-display-retention
---

# Pipeline list has no display retention, unlike runs; terminal pipelines accumulate forever

## Problem

`listPipelines()` is `SELECT ${PIPELINE_COLUMNS} FROM pipelines` with no cap and no age filter (`v2/src/persistence/state-store.ts`), so `jarvis pipeline list`, the `jarvis tui` work tree, and the needs-attention segment grow unbounded — every pipeline ever admitted is painted forever. Runs already solve this: the daemon caps `list` at the 50 newest terminal runs (`LIST_TERMINAL_RUN_LIMIT`, `v2/src/daemon/daemon.ts`), while durable state keeps them all and `jarvis run list --since` queries history. Pipelines have no equivalent. Dogfooding 2026-08-16 reached 26 pipelines (mostly weeks-old terminal dogfood) with no way to shed them. The durable records must be kept — this is a display cap, not a purge.

## Decisions

- Apply a display-retention policy to terminal pipelines mirroring the run policy: the default `pipeline_list` projection returns only the N newest terminal pipelines (plus all non-terminal — running/awaiting — pipelines, which always show), with a `--since <duration|timestamp>` / `--all` escape hatch to query beyond the window, exactly like `jarvis run list --since`. Rules out unbounded default projection; rules out hiding live/awaiting work.
- Retention is display-only: durable `pipelines`/`pipeline_stages`/`pipeline_stage_admission` rows are untouched and remain queryable. Rules out any delete/prune of durable state (that is the operator dismiss action's concern in `operator-dismisses-pipelines-from-display`, and even that hides rather than deletes).
- Non-terminal pipelines (`running`, `awaiting-approval`) are never aged out — the operator still needs to act on them. Rules out capping live work by count/age.
- The TUI work tree and needs-attention segment consume the same retained projection so all three surfaces shrink together. Rules out fixing only the CLI.
- Choose the terminal cap/window to match or reference the run policy (50 newest terminal, or an age window) — a plan decision; keep it consistent with runs so operators learn one rule.

## Acceptance criteria

- [ ] The default `pipeline_list` projection returns all non-terminal pipelines plus only the newest-N (or within-window) terminal pipelines, pinned by a daemon/state test seeded with more terminal pipelines than the cap.
- [ ] `jarvis pipeline list --since <duration>` (and/or `--all`) returns terminal pipelines beyond the default window, pinned by a test.
- [ ] Running and awaiting-approval pipelines are always included regardless of count/age, pinned by a test.
- [ ] The TUI work tree and needs-attention segment reflect the same retained projection, pinned by pure-function tests over those models.
- [ ] Durable pipeline rows are unchanged by retention (a beyond-window pipeline is still loadable by id and via `--since`), pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline list now has display retention like runs (default newest-N terminal + always-on non-terminal; `--since`/`--all` for history). Cross-link `operator-dismisses-pipelines-from-display` and the attention seed `tui-attention-segment-suppresses-stale-terminal-incidents`.
- `v2/docs/daemon-host.md` — the pipeline_list retention window and its parity with run retention.
