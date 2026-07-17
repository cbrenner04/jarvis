# 00 - Extract a non-interactive safe-retirement seam from cleanup

## Problem

The capacity guard (01) must retire only cleanup-eligible worktrees using the same
ownership rules as `jarvis cleanup`. Today that logic — discovery, eligibility, the
immediate pre-removal recheck, and Git removal — is only reachable through
`runCleanupCommand`'s interactive prompt/dry-run/IO flow in `v2/src/commands/cleanup.ts`.
Expose it as a non-interactive seam so the guard reuses one definition of reclaimable
workspace instead of duplicating (and drifting from) the ownership gate.

## Decisions

- Route `runCleanupCommand`'s retirement through the extracted seam so cleanup and the guard share one code path; rules out a parallel guard-only copy that can diverge from the CLI's ownership rules.
- Preserve the immediate pre-removal eligibility recheck inside the seam; rules out a seam that removes on a stale classification and races a run that went live mid-cleanup.
- Keep the seam non-interactive (no prompt, no stdout/stderr coupling, results returned as data); rules out threading the guard through cleanup's confirmation IO.
- Behavior-preserving for `jarvis cleanup`: no change to which workspaces it retires or its operator output.

## Task checklist

- Factor discovery + eligibility + recheck + `git worktree remove`/`prune`/`branch -D` into a reusable non-interactive function with injectable Git, registry, daemon, and state seams.
- Re-point `runCleanupCommand` at the seam; keep its prompt/dry-run/IO behavior unchanged.
- Add unit coverage exercising the seam directly (eligible-retired, ineligible-untouched, recheck-flips-to-ineligible).

## Acceptance criteria

- [x] `v2/src/commands/cleanup.ts` retirement runs through a single non-interactive seam that returns retired/skipped workspaces as data with no prompt or stdout/stderr coupling.
- [x] The existing cleanup eligibility and removal tests (`v2/src/commands/eligibility-gate.test.ts` and the cleanup command tests) stay green — `jarvis cleanup` retires and skips the same workspaces with the same operator output (behavior unchanged by the extraction).
- [x] A unit test drives the extracted seam directly and asserts it retires an eligible merged workspace, leaves live/unmerged/daemon-unknown workspaces untouched, and re-runs the eligibility check immediately before removal (a workspace that goes ineligible between discovery and removal is not retired).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None required — internal extraction; `jarvis cleanup` behavior and operator surface are unchanged, so no `v1-behaviors.md` entry.
