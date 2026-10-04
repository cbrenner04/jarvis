---
name: state-store-wal-sidecar-copy-and-remove
---

# State-store copy and remove paths include WAL sidecars

## Problem

WAL mode places `-wal` and `-shm` files beside `v2.sqlite`. Any harness path that copies, backs up,
or deletes only the main database file can leave a torn or unopenable store and lose committed rows.

## Decisions

- Audit every in-repo path that copies or removes the orchestration database and extend it to treat
  `v2.sqlite`, `v2.sqlite-wal`, and `v2.sqlite-shm` as one unit — rules out assuming a single-file
  store; the plan subspec enumerates audited paths once the audit lands.
- Prefer the existing backup/purge mechanisms over inventing a parallel operator ritual — rules out
  documenting manual sidecar handling as the primary contract.
- Deferred to first consumer: whether backup uses SQLite's online backup API vs filesystem copy — pin
  when the audited path's first change lands.

## Acceptance criteria

- [ ] A test exercises each audited copy/remove path against a WAL-backed store with committed rows
      and asserts a round-trip preserves those rows; it fails when sidecars are omitted.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — operator-facing note that backup, purge, and hand-copy must include
  `-wal` and `-shm` (cross-link from the WAL section if already present).

## Sibling order

Same `StateStore` / runbook seam — plan and run serially after each predecessor merges to `main`:
(1) `state-store-wal-concurrent-writes`, (2) this intent, (3)
`resume-after-state-store-lock-timeout`. No parallel plan fan-out on one base.

## Prerequisites

- `state-store-wal-concurrent-writes` merged — `journal_mode = wal` so `-wal` and `-shm` sidecars
  exist beside the database file.
