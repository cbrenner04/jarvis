---
name: implement-admits-externally-landed-specs
---

# v2 implement admits externally landed specs for git-disabled-planning projects

## Problem

For a `plan.commit: false` project, v2 plan lands the spec tree externally (`~/.jarvis/specs/<projectSafeId>/plans/<name>/`). `jarvis run workflow implement --base main --spec <that index.md>` refuses with `Spec path outside registered project roots`, so such projects have no v2 implement path at all — the only route is `jarvis1 run`, which hard-requires the operator log server (#3122). Combined with #3119, `plan.commit: false` projects cannot ride v2 end to end.

## Evidence (2026-08-29, #3122)

Project `homestead-service`, spec `~/.jarvis/specs/homestead-service/plans/household-tenant-persistence/index.md` landed by v2 plan run `d0ec2da0`; CLI implement refused with the message above.

## Decisions

- Implement admission (CLI `--spec` resolution) additionally accepts a spec path under a registered project's external landing home `~/.jarvis/specs/<projectSafeId(key)>/plans/**`, resolving the owning project from the safe-id path segment. Rules out requiring the operator to copy spec trees into the repo.
- Code flows through the normal implement contract unchanged — worktree materialized from `--base`, ordinary commits, draft PR, gates. Only the spec tree is external: routing reads it and criteria/index ticks write it in place in the external home; spec files are never committed to the target repo. Mirrors v1's external-spec handling.
- Preflight completeness (`implement.already_complete`), incomplete re-run gates, and cleanup archival treat the external tree as the spec source of truth for these runs; external specs archive within the external home (`completed/` sibling), not the repo.
- The chained pipeline implement stage after a git-disabled plan resolves through the same admission (with the #3119 matcher fix supplying project identity). Rules out CLI-only coverage.
- Prerequisite: shared `projectSafeId` (`share-external-workspace-project-safe-id`). Sibling: `match-git-disabled-chained-stage-workspaces` (#3119).
- Out of scope: `--ready-intent` external-landing admission for plan (tracked separately if it recurs), multi-project external homes, v1 changes.

## Acceptance criteria

- [ ] A workflow-args/admission test proves `--spec` under `~/.jarvis/specs/<safeId>/plans/<name>/index.md` for a registered `plan.commit: false` project resolves that project and admits; it fails against the current refusal.
- [ ] An implement routing test proves subspec selection reads the external index/subspecs and criteria ticks land in the external tree while the materialized worktree carries only code changes.
- [ ] A preflight test proves a fully ticked external tree exits `implement.already_complete` without materialization.
- [ ] A chained-stage test proves a pipeline implement stage after a git-disabled plan dispatches through the same admission.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` and `v2/docs/write-behavior.md` — external-spec implement contract (admission, routing, ticking, archival).
- `v2/docs/operator-runbook.md` — `plan.commit: false` projects ride v2 implement via the external home; remove any contrary caveat.
- `v2/docs/v1-behaviors.md` — v2 parity note for v1's external-spec no-commit handling.

## Migration follow-up (homestead-service, operator 2026-08-30)

Homestead currently works around the missing v2 external-implement path with a split: some repo files gitignored, some artifacts in the external `~/.jarvis/specs/homestead-service/` dir. Once this lands, homestead needs a deliberate migration plan off that split onto the clean external-home flow — downstream homestead-project work that this seed enables, not part of this seed's scope. Trigger the migration when this ships.
