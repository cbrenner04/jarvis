# Plan-branch merge eligibility

## Problem

`jarvis1 triage <plan-pr|plan-worktree> --merge` refuses before merge because `triageMerge` applies implementation acceptance-criteria completion to every branch. Plan-generated spec PRs have unchecked subspec AC by design.

## Prerequisites

- `jarvis1 triage <target> --merge` runs the gated admin-squash merge path for implementation PRs after target resolution.
- `--mark-ready` and resolved `--merge` worktrees derive spec paths from branch names when `.active-spec-path` is absent.

## Out of scope

- Markerless timestamped `plan-spec-path` entry (`jarvis1 triage <v1/spec/YYYY-…-name/index.md> --merge` without marker-backed resolution) — ships in ready-intent `triage-resolve-plan-spec-path-merge-target`; no AC here until that intent lands.

## Decisions

- Extend `triage --merge` only — rules out `jarvis1 merge-plan` or a plan-only merge command.
- Treat `plan/*` head branches as plan PRs for merge eligibility — rules out inferring plan vs patch from worktree directory name alone.
- Skip `isSpecComplete` in `triageMerge` for plan branches only — rules out requiring checked subspec AC before landing a spec-only PR.
- Keep `isSpecComplete` for non-`plan/*` branches — rules out weakening implementation PR safety.
- Reuse the existing gated merge sequence unchanged (ready gate → optional `gh pr ready` → CI poll → admin squash) — rules out a plan-only hand-merge shortcut.
- Merge lands the spec PR only; no `jarvis1 run` or other post-merge side effects — rules out auto-starting implementation.
- Refusal stderr uses three target classes only (`plan PR`, `implementation PR`, `unknown worktree`) — rules out a fourth `non-mergeable state` label and opaque branch-kind inference.
- Class-prefixed refusals use exactly `triage --merge (<class>):` before the existing reason stem — rules out embed-only or alternate label strings.
- Emit `unknown worktree` only before branch classification (resolution failures); emit `plan PR` or `implementation PR` only after the resolved worktree head branch is known — rules out branch-kind labels on unclassified inputs.
- Resolution failures keep today's reason stems (`unresolvable target`, `no worktree found for spec path`, `multiple worktrees match spec path`, `no local worktree for PR reference`, `failed to look up PR reference`, closed/missing PR lookup messages, `findMatchingOpenPrs` messages); class prefix is additive — rules out blind stem replacement.
- Scope is `--merge` only; `--mark-ready` completeness semantics stay unchanged — rules out widening finalize behavior beyond merge.
- Deferred to first consumer: additional plan-only pre-merge guards beyond open PR + gate + CI — pin when the first failing plan PR surfaces a gap.

## Tasks

- [ ] Branch-classify merge targets in `triageMerge` (`plan/*` vs patch) and skip `isSpecComplete` for plan branches.
- [ ] Add `triage --merge (<class>):` prefixes on `--merge` refusal stderr per the resolution vs post-resolution map below.
- [ ] Add tests: plan worktree and PR-ref entry points with `plan/<name>` head branches, unchecked subspec AC, gates passing; patch incomplete-spec refusal preserved; plan post-resolution refusals omit `implementation PR`; symmetric guards on class labels.
- [ ] Update `triage-command.test.ts` resolution anchors listed in acceptance criteria (intentional new prefix behavior).
- [ ] Update durable docs (below).

## Acceptance criteria

- [ ] `jarvis1 triage <plan-worktree> --merge` admin-squash-merges an open plan PR when the local ready gate passes and CI is green, even when linked subspec acceptance criteria remain unchecked; fixture worktree head branch is `plan/<name>`.
- [ ] `jarvis1 triage <plan-pr-ref> --merge` reaches the same gated merge outcome when PR lookup resolves to a local worktree whose head branch is `plan/<name>`.
- [ ] `jarvis1 triage <patch-worktree> --merge` still refuses with a non-zero exit when linked subspec acceptance criteria are unchecked (`triage-command.test.ts` `--merge with incomplete spec returns error` stays green; refusal line starts with `triage --merge (implementation PR):`).
- [ ] Patch-branch gated merge behavior is otherwise unchanged (`triage-command.test.ts` existing `--merge` gate/CI/merge cases stay green).
- [ ] Resolution-stage refusals prefix `triage --merge (unknown worktree):` and retain existing stems: `triage-command.test.ts` `--merge on unknown worktree returns error` (`unresolvable target`), `unresolvable spec path reports clear error without merge` (`no worktree found for spec path`), `ambiguous spec path lists candidates without merge`, `PR reference with no local worktree reports clear error`, `findMatchingOpenPrs refusal at PR-ref resolution`, `gh failure during PR lookup reports error without merge`, `closed PR at resolution reports error without merge`.
- [ ] Post-resolution refusals on a resolved `plan/*` target prefix `triage --merge (plan PR):` for `no spec found for branch`, `no PR found`, merged/closed PR, ready-gate failure, CI red/pending timeout, worktree lock, merge transport failure, and `findMatchingOpenPrs refusal at merge pre-check` (existing reason stems retained after the prefix); same failure classes on patch targets prefix `triage --merge (implementation PR):` (`triage-command.test.ts` `--merge with missing .active-spec-path and no matching spec returns error`, `--merge when no PR exists returns error`, `--merge when PR is merged returns error`, `--merge when PR is closed returns error`, `--merge with local gate failure refuses to merge`, `--merge with red CI check refuses to merge`, `findMatchingOpenPrs refusal at merge pre-check` — prefix added, stems preserved).
- [ ] Plan-target post-resolution refusals for gate/CI/lock/transport/merged/closed/incomplete-spec classes do not contain `implementation PR`.
- [ ] Successful merge performs no `jarvis1 run` or implementation worktree creation (`triage-command.test.ts` existing `--merge` success cases stay green — no run/worktree side effects).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- [ ] `v1/docs/operator-runbook.md` — Merging: name plan PR and plan worktree as supported `triage --merge` targets; state plan PRs may `--merge` with unchecked subspec AC while `--mark-ready` still requires spec completeness; drop any caveat that plan PRs must merge outside Jarvis.
- [ ] `v2/docs/v1-behaviors.md` — extend `triage --merge` with plan-branch eligibility (AC completion skipped for `plan/*`), patch-branch preservation, `--mark-ready` vs `--merge` asymmetry, pinned `triage --merge (<class>):` refusal prefix and three-class taxonomy, and no post-merge run side effects.
