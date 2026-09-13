# Protect admission during handoff

## Problem

The incoming daemon can admit a fresh start or resume before it accounts for reachable draining ownership, allowing the same `(project, branch)` worktree or invocation to be driven twice.

## Behavior

New starts and eligible resumes remain incoming-generation admissions only after route readiness. A reachable draining owner blocks a conflicting fresh start and prevents resume or force claim of its owned work.

## Decisions

- Check the ready ownership directory before incoming admission claims; rules out a fresh start overlapping a reachable draining owner's `(project, branch)` worktree.
- Keep `start` and eligible non-owned `resume` local to the incoming generation; rules out admitting new work through a retiring daemon.
- Refuse resume while any confirmed route owns the requested run, regardless of that row's public `isLive`; rules out two generations driving a paused or workflow-sibling invocation.
- Forward force kill for a reachable owner rather than force-settling locally; rules out local settlement racing an owner that may still receive abort.
- Do not retry a refused or failed forwarded mutation as a local mutation; rules out transfer-by-error during a handoff race.

## Tasks

- Apply route-aware ownership checks to local start, resume, and force-settlement admission.
- Preserve incoming-only execution for non-conflicting starts and eligible resumes.
- Cover worktree exclusion and immediate handoff races without moving execution between generations.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-admission-routing.test.ts` proves a fresh start cannot claim the `(project, branch)` held by a reachable draining owner, while an unrelated start executes on the incoming generation; it fails against the pre-fix local-only registry check.
- [ ] `v2/src/daemon/daemon-run-admission-routing.test.ts` proves an eligible non-owned resume executes on the incoming generation, while resume cannot claim a run still owned by a draining route; it fails against the pre-fix successor-local resume admission.
- [ ] `v2/src/daemon/daemon-run-admission-routing.test.ts` proves an immediate post-handoff force kill routes to the owner after readiness and never force-settles locally; it fails against the pre-fix local force path.
- [ ] `v2/src/daemon/daemon-resume.test.ts` stays green (single-generation resume admission unchanged).

## Documentation updates

- `v2/docs/daemon-host.md` — document incoming-only admission and cross-generation worktree exclusion after route readiness.
- `v2/docs/v1-behaviors.md` — record that reachable draining ownership blocks duplicate admission without transferring execution.
