# Terminal peer-owned rows admit in `admitRunForResume`

## Problem

`StateStore.admitRunForResume` refuses `owner_alive` whenever the row's `owner_identity` differs from the current generation and that owner is alive — including terminal rows still stamped by a prior generation that is draining after a `v2/src` merge. `run list` / `wait` can still project `resumable: true` via `resolveRunResumeAdmission` while `jarvis run resume` fails at owner-stamp admission.

## Decisions

- Gate the live-peer refusal with `isTerminalRunStatus` on the row's current status before returning `owner_alive`; rules out admitting `paused`, `queued`, `in-progress`, or `budget-soft-stopped` rows from a live peer.
- Terminal rows whose prior owner is alive proceed to the existing CAS `UPDATE` (re-stamp `owner_identity`, clear terminal fields); rules out a new operator flag or alternate claim RPC.
- Non-terminal rows with a live different owner keep the unconditional `owner_alive` refusal; rules out widening claim to in-flight peer-owned work.
- Replace the `state-store.test.ts` case `"refuses owner_alive …"` that pins `status: "failed"` with a live peer so the suite encodes non-terminal refusal separately from terminal peer claim; rules out leaving a regression that forbids the new terminal contract.

## Tasks

- [x] Load run status in `admitRunForResume` and skip `owner_alive` when `isTerminalRunStatus(status)`.
- [x] Add or adjust tests in `v2/src/persistence/state-store.test.ts` per acceptance criteria.

## Acceptance criteria

- [x] A regression test in `v2/src/persistence/state-store.test.ts` proves `admitRunForResume` admits a terminal row whose different owner is alive, re-stamping `owner_identity` and clearing terminal fields; it fails against the pre-fix unconditional `owner_alive` refusal (including the prior `failed` + live-peer pin).
- [x] A regression test in `v2/src/persistence/state-store.test.ts` proves `admitRunForResume` still refuses `owner_alive` for a non-terminal row (`paused` or `in-progress`) whose different owner is alive, leaving `owner_identity` and status unchanged; it fails if non-terminal peer-owned rows stop refusing.
- [x] A regression test in `v2/src/persistence/state-store.test.ts` proves concurrent claims of the same terminal peer-owned row admit exactly one caller and return `claim_lost` to the other; it fails against the pre-fix refusal path.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator and architecture docs land in [02-resume-admission-docs.md](02-resume-admission-docs.md).
