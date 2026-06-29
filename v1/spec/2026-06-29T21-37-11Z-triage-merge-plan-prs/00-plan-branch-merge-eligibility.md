# Plan-branch merge eligibility

## Problem

`jarvis1 triage <plan-pr|plan-worktree|plan-spec> --merge` refuses before merge because `triageMerge` applies implementation acceptance-criteria completion to every branch. Plan-generated spec PRs have unchecked subspec AC by design.

## Decisions

- Extend `triage --merge` only — rules out `jarvis1 merge-plan` or a plan-only merge command.
- Treat `plan/*` head branches as plan PRs for merge eligibility — rules out inferring plan vs patch from worktree directory name alone.
- Skip `isSpecComplete` in `triageMerge` for plan branches only — rules out requiring checked subspec AC before landing a spec-only PR.
- Keep `isSpecComplete` for non-`plan/*` branches — rules out weakening implementation PR safety.
- Reuse the existing gated merge sequence unchanged (ready gate → optional `gh pr ready` → CI poll → admin squash) — rules out a plan-only hand-merge shortcut.
- Merge lands the spec PR only; no `jarvis1 run` or other post-merge side effects — rules out auto-starting implementation.
- Refusal stderr names the target class (`plan PR`, `implementation PR`, `unknown worktree`, `non-mergeable state`) before the specific reason — rules out opaque messages that force operators to infer branch kind.
- Scope is `--merge` only; `--mark-ready` completeness semantics stay unchanged — rules out widening finalize behavior beyond merge.
- Deferred to first consumer: additional plan-only pre-merge guards beyond open PR + gate + CI — pin when the first failing plan PR surfaces a gap.

## Tasks

- [ ] Branch-classify merge targets in `triageMerge` (`plan/*` vs patch) and skip `isSpecComplete` for plan branches.
- [ ] Prefix or embed target-class labels on `--merge` refusal stderr (resolution, pre-check, gate, CI, merge transport).
- [ ] Add tests: plan worktree / PR ref / spec-path (marker-backed) merges with unchecked subspec AC when gates pass; patch incomplete-spec refusal preserved; refusal lines name the expected class.
- [ ] Update durable docs (below).

## Acceptance criteria

- [ ] `jarvis1 triage <plan-worktree> --merge` admin-squash-merges an open plan PR when the local ready gate passes and CI is green, even when linked subspec acceptance criteria remain unchecked.
- [ ] `jarvis1 triage <plan-pr-ref> --merge` and `jarvis1 triage <plan-spec-path> --merge` reach the same gated merge outcome when the resolved worktree heads a `plan/*` branch.
- [ ] `jarvis1 triage <patch-worktree> --merge` still refuses with a non-zero exit when linked subspec acceptance criteria are unchecked (`triage-command.test.ts` `--merge with incomplete spec returns error` stays green; refusal names `implementation PR`).
- [ ] Patch-branch gated merge behavior is otherwise unchanged (`triage-command.test.ts` existing `--merge` gate/CI/merge cases stay green).
- [ ] Unknown or unresolvable `--merge` targets name `unknown worktree` in stderr (worktree missing, spec with no backing worktree, PR with no local worktree).
- [ ] Non-mergeable refusals on a resolved plan target name `plan PR` in stderr (merged/closed PR, ready-gate failure, CI red/pending timeout, worktree lock, merge transport failure).
- [ ] Non-mergeable refusals on a resolved patch target name `implementation PR` in stderr for the same failure classes plus incomplete-spec refusal.
- [ ] Successful merge performs no `jarvis1 run` or implementation worktree creation.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- [ ] `v1/docs/operator-runbook.md` — Merging: name plan PR / plan worktree / plan spec path as supported `triage --merge` targets; drop any caveat that plan PRs must merge outside Jarvis.
- [ ] `v2/docs/v1-behaviors.md` — extend the `triage --merge` entry with plan-branch eligibility (AC completion skipped), patch-branch preservation, refusal taxonomy, and no post-merge run side effects.
