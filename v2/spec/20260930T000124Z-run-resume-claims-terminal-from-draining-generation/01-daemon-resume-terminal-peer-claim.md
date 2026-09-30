# `run resume` succeeds when list projects resumable on a terminal peer-owned row

## Problem

After [00-admit-terminal-peer-owned-row.md](00-admit-terminal-peer-owned-row.md), the store admits terminal peer-owned rows, but operators still need proof that the daemon `resume` RPC path — which calls `admitRunForResume` after `resolveRunResumeAdmission` — no longer contradicts `run list` `resumable: true` on the same row shape reachable on main today via projection-only admission.

## Decisions

- Extend `v2/src/daemon/daemon-run-resume-owner-stamp.test.ts` rather than duplicating handler wiring elsewhere; rules out a one-off RPC harness disconnected from existing owner-stamp coverage.
- Fixture uses a terminal row (e.g. `failed`) stamped by identity A with B alive on the peer probe and a stable generation C (or B) resuming after list-level admission would pass; rules out exercising only the paused non-terminal handoff cases already covered in that file.

## Tasks

- [ ] Add a regression test that lists or asserts `resolveRunResumeAdmission` would admit, then calls `handlers.resume` and expects success with re-stamped owner.
- [ ] Keep existing non-terminal peer refusal behavior covered by store tests in subspec 00; do not weaken paused live-owner tests in this file unless they assert a different contract.

## Acceptance criteria

- [x] A regression test in `v2/src/daemon/daemon-run-resume-owner-stamp.test.ts` proves `run resume` succeeds when `run list` shows `resumable: true` for a terminal peer-owned row; it fails against the pre-fix store `owner_alive` refusal after list already advertised resume.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — see [02-resume-admission-docs.md](02-resume-admission-docs.md).
