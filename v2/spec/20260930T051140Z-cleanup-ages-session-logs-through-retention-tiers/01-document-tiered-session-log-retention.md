# Document tiered session-log retention

## Problem

Operator docs and the v1-behavior baseline still describe single-window plain-log deletion, flat-only discovery, and `hotDays` with no runtime effect.

## Decisions

- Durable operator semantics live in `v2/docs/operator-runbook.md` § Session-log retention; the v1 parity catalog entry in `v2/docs/v1-behaviors.md` is updated in the same change, not duplicated — rules out divergent tier descriptions across files.
- `v2/docs/install-and-config.md` § Cleanup updates the `hotDays` / `coldDays` rows to match tier behavior and shard-aware scope; rules out leaving "no runtime effect" on `hotDays` after subspec 00 lands.

## Task checklist

- [ ] Rewrite `v2/docs/operator-runbook.md` § Session-log retention: hot/cold/gone tiers, `finishedAt` vs orphan mtime aging, flat plus `sessions/<YYYY-MM>/` discovery, tiered dry-run output, reading `.log.gz` with standard gzip tooling, invalid-config slice refusal, and preserved non-`.log` exclusions.
- [ ] Replace the `v2/docs/v1-behaviors.md` cleanup session-log retention bullet with the tiered contract (no single-window plain delete at `coldDays`, shard-aware discovery).
- [ ] Align `v2/docs/install-and-config.md` § Cleanup table rows with tier semantics and shard scope.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` § Session-log retention documents hot plain logs, cold `.log.gz`, gone deletion, month-shard plus legacy flat discovery, tiered dry-run counts and byte totals, and `.log.gz` reading — consistent with subspec 00 behavior.
- [x] `v2/docs/v1-behaviors.md` cleanup session-log retention entry documents tiered retention and supersedes the single-window reaper contract described on main before subspec 00.
- [x] `v2/docs/install-and-config.md` § Cleanup documents `hotDays` as the plain-to-gzip boundary and `coldDays` as the gzip deletion boundary with shard-aware reaper scope.

## Documentation updates

- `v2/docs/operator-runbook.md` — hot/cold/gone behavior, shard layout, dry-run output, and `.log.gz` reading.
- `v2/docs/v1-behaviors.md` — replace the single-window reaper contract with tiered retention.
- `v2/docs/install-and-config.md` — `retention.sessions` row semantics and scope after tiered reaper lands.
