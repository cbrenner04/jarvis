# Release ownership after terminal repair cleanup

## Problem

- A settled run can leave either `.jarvis.lock` or the daemon registry claim live, refusing the next implement workflow on the same `(project, branch)`.

## Decisions

- `.jarvis.lock` and the daemon registry claim are separate owned resources. After repair has quiesced, both release through their owning lifecycles before `completed`, `failed`, or `killed` becomes observable.
- A daemon kill, including one during repair, follows the same boundary: the kill request does not make `killed` observable or permit re-admission until repair has quiesced and both resources are released.
- Immediately after durable terminal observation, a same-key implement launch is admitted without awaiting the prior workflow promise or deferred cleanup.

## Work

- Release the owning managed-worktree lock on each covered terminal path after repair stops.
- Release the matching daemon registry claim on the same boundary.
- Exercise normal completion, failure, and real daemon kill during repair, then prove immediate same-key dispatch.
- Add mutation guards for both releases and kill ordering.
- Document terminal ownership release.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` adds a pre-fix-failing regression through the real daemon path that reaches `completed`, `failed`, and `killed` (including kill during repair); after each durable terminal observation, it launches `jarvis run workflow implement` on the same `(project, branch)` without awaiting the old workflow promise and observes positive dispatch (run creation or invocation start), not `holds worktree lock` or `worktree_claimed`.
- [ ] The regression independently proves the physical `.jarvis.lock` and daemon registry claim have each been released through their owners only after repair process and invocation-promise quiescence; a second writer is not admitted earlier.
- [ ] Inverting physical-lock release, registry-claim release, or daemon-kill ordering turns its corresponding same-key re-admission regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` record release of both ownership layers after repair stops for `completed`, `failed`, and `killed`, including kill during repair.

## Documentation updates

- `v2/docs/daemon-host.md` — release the managed-worktree lock and registry claim only after repair quiesces, including daemon kill during repair.
- `v2/docs/v1-behaviors.md` — v2 finalization-repair settlement and both terminal ownership releases.
