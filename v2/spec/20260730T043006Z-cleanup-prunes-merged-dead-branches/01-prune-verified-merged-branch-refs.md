# Prune verified merged branch refs

## Problem

An admitted branch must be deleted safely as two local refs, including when it
was just retired from a managed worktree. Preview state must not authorize a
later changed ref.

## Decision ledger

- Delete only exact `refs/heads/<branch>` and an existing exact `refs/remotes/origin/<branch>`; never delete a remote branch. A similarly named tag does not establish the tracking ref's presence.
- Successfully retired merged worktrees use this same prune path. At apply time, revalidate local-head and tracking-ref OIDs, merged-PR authority, checkout status, and durable/daemon run ownership; a changed or newly protected candidate is skipped.
- Dry-run reports each existing full ref without mutating refs, worktrees, artifacts, sockets, or remotes. Preview, success, and failure lines include project identity and the full ref.
- Within one candidate, a failed head or tracking-ref deletion emits no success for that ref, makes cleanup nonzero, and does not prevent later eligible candidates. Later ref deletion, artifact archival, socket cleanup, and stranded-artifact cleanup continue according to their existing independent cleanup paths; a worktree retirement is reported successful only when its required retirement and ref-prune work succeeds.
- Preserve existing confirmation, merged-worktree eligibility, artifact archival, daemon-socket reaping, `--abandon`, and stale-reset behavior outside the added head-only candidates.

## Task checklist

- [ ] Route eligible local heads and successfully retired managed worktrees through one exact local-ref prune path for heads and existing `origin` tracking refs.
- [ ] Revalidate candidate ref OIDs, PR authority, checkout status, and durable/daemon run ownership immediately before mutation.
- [ ] Report dry-run, apply, skips, and failures with project identity and every affected full ref; aggregate failures while continuing independent cleanup work.
- [ ] Add fixture and injected-runner coverage for exact-ref inspection, apply-time races, ref failures, and output; extend CLI coverage only if command-boundary wiring changes.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `default cleanup prunes merged branch refs without a materialized worktree` fails against the pre-fix tree and passes after: apply removes `refs/heads/<branch>` and an existing `refs/remotes/origin/<branch>`, reports each with its project identity, and never invokes remote-branch deletion.
- [x] `v2/src/commands/cleanup.test.ts` test `default merged-worktree retirement prunes origin tracking ref` fails against the pre-fix tree and passes after: successful retirement removes and reports both local refs through the common prune path.
- [x] `v2/src/commands/cleanup.test.ts` test `dry-run previews merged dead refs without mutation` fails against the pre-fix tree and passes after: every would-prune full ref and its project is listed while local heads, tracking refs, worktrees, artifacts, sockets, and the remote remain unchanged.
- [x] Guard-inversion coverage in `v2/src/commands/cleanup.test.ts` fails if apply-time head/tracking OID, PR authority, checkout status, durable-run ownership, or daemon-run ownership revalidation is removed; a ref changed after preview is not deleted.
- [x] Guard-inversion coverage in `v2/src/commands/cleanup.test.ts` fails if an orphan tracking ref is swept, a tag makes a similarly named exact tracking ref appear present, or remote deletion is attempted.
- [x] `v2/src/commands/cleanup.test.ts` test `ref-prune failures continue independent cleanup` fails against the pre-fix tree and passes after: no failed deletion is reported as success, cleanup is nonzero, later eligible candidates and independent archival, socket, and stranded-artifact cleanup continue, and retirement success is not reported when its required prune fails.
- [x] Existing `v2/src/commands/cleanup.test.ts` merged-worktree eligibility, artifact archival, `--abandon`, and stale-reset coverage stays green.

## Documentation updates

- None in this slice; the final documentation slice records the completed operator contract.
