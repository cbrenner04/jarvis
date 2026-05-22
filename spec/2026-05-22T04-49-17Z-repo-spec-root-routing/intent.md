---
name: repo-spec-root-routing
---

# Intent

Jarvis should stop treating the repository root `spec/` directory as the place
to save newly created specs for this repo.

The current repo guidance is that implementation specs for the shipping harness
live under `v1/spec/`, and future v2 planning/implementation material lives
under `v2/spec/`. The root-level `spec/` location is no longer the intended
home for repo-owned specs, even if some older flows or assumptions still refer
to it.

This likely means there is still code, prompt text, documentation, or path
selection logic that defaults to `spec/` when creating or talking about specs
for work in this repository. That behavior should be updated so new spec
authoring follows the repo's current layout instead of recreating a deprecated
root directory convention.

Rough scope:

- Find where Jarvis or its docs still assume root-level `spec/` for this repo.
- Update the relevant behavior so new specs land in the correct versioned area
  (`v1/spec/` today, with `v2/spec/` reserved for v2 work as intended by repo
  guidance).
- Update any user-facing guidance or examples that still mention root `spec/`
  for in-repo spec creation here.

Important nuance:

- This is about this repository's own spec layout, not about removing support
  for external no-commit specs stored under `~/.jarvis/specs/...`.
- If root `spec/` handling still exists for compatibility, the intent is at
  least to stop using it as the default for new work in this repo.

Desired outcome:

Creating or documenting new spec work for `jarvis` no longer points at or
populates `spec/` in the repo root, and instead follows the versioned spec
locations described in `AGENTS.md`.

## Refine turn 1

Repo inspection shows a concrete mismatch between this repo's `AGENTS.md`
guidance and Jarvis's current plan-mode assumptions. `AGENTS.md` says repo-owned
specs for this repository belong under `v1/spec/` and `v2/spec/`, but the
current generic spec guidance and multiple plan-mode code paths still hard-code
`spec/<name>/...` for committed in-repo plan artifacts.

The draft should treat this as a repo-specific defaulting/routing change, not a
global removal of root-level `spec/` support. Generic Jarvis behavior still
needs to keep supporting repos whose committed specs live under `spec/`, as well
as the existing no-commit external storage under `~/.jarvis/specs/...`.

Likely implementation surfaces already visible in the repo include:

- plan-mode spec-directory resolution and creation, which currently default to
  `join(worktreePath, "spec", specDirBasename)`;
- write-boundary and blocker messaging that currently assume only
  `spec/<name>/...` is valid;
- resume/help/next-step text and PR metadata that print `spec/<name>/...`
  paths;
- stable docs and prompts that describe committed in-repo specs as living under
  `spec/<timestamp>-<slug>/`.

The draft should decide one explicit source of truth for "where do specs for the
Jarvis repo go?" rather than scattering special cases. The cleanest direction
appears to be a repo-aware spec-root selection mechanism that can keep the
generic default as `spec/` for normal target repos while selecting `v1/spec/`
for work on the shipping harness in this repository. If `v2/spec/` remains
reserved rather than active, the initial behavior can likely target `v1/spec/`
only and document the boundary clearly instead of inventing automatic v1/v2
classification rules.

Scope boundary for the eventual implementation spec: update only new-spec
authoring, path display, and repo guidance for this repository. Avoid broad
changes to patch-mode spec consumption unless the code proves that `jarvis1 run`
or other existing readers cannot operate correctly when given a spec under
`v1/spec/...`.

## Refine turn 2

Repo inspection narrows the implementation toward a small routing layer rather
than one-off string fixes. Today the plan-mode helper
`resolvePlanSpecDirPath()` defaults committed specs to `join(worktreePath,
"spec", specDirBasename)`, while `prepareResume()`, `deriveSpecName()`,
`PLAN_USAGE`, the phase-0 review blocker text, and boundary enforcement in
`src/modes/plan/boundary.ts` still assume committed specs live under
`spec/<spec-dir>/...`. The draft should treat those as one behavior family with
one source of truth for the committed in-repo spec root.

The implementation spec should explicitly decide whether that source of truth is
repo detection, config, or a repo-local convention helper, but it should avoid
duplicating Jarvis-repo special cases across CLI text, boundary checks, PR/body
rendering, and resume validation. A good acceptance shape is that the same
resolved committed spec root drives:

- initial spec-directory creation for `jarvis1 plan`;
- resume and `--resume-draft` file existence checks;
- write-boundary enforcement and blocker text;
- human-facing next-step commands, usage/help text, and plan PR metadata;
- committed-plan docs/examples for this repository.

There is also a compatibility constraint worth making explicit: the draft should
not require migrating or renaming old root-level `spec/...` trees in this repo
unless code inspection proves that unavoidable. Existing historical specs under
root `spec/` and the generic docs/examples for ordinary target repos may need
to remain readable and resumable, even if new Jarvis-internal spec creation now
targets `v1/spec/...`.

Documentation scope should stay split-brained on purpose. Stable global docs
currently describe the generic in-repo convention as `spec/<timestamp>-<slug>/`
and should only become repo-specific where they are actually describing work on
this repository itself. The implementation spec should avoid accidentally
rewriting generic user guidance for external target repos into `v1/spec/...`,
because that would overfit Jarvis's own layout onto everyone else.

## Refine turn 3

Repo inspection shows one more behavior cluster the draft should call out
explicitly: plan-mode commit metadata and PR rendering currently encode the
committed spec path as `spec/...`, not just the on-disk directory creation.
Today `src/modes/plan/commits.ts` hard-codes `Spec: spec/<spec-dir>/intent.md`
in refine/draft/review/blocker commit bodies, and `src/modes/plan/pr.ts`
recognizes plan meta-commits and renders the PR header by matching and printing
that same `spec/...` shape. If the implementation only changes directory
creation and resume checks, Jarvis plan PR metadata will drift or break.

The implementation spec should therefore treat "committed spec root" as a
shared formatting concern as well as a path-resolution concern. One acceptance
boundary to make explicit is that the same resolved in-repo spec root should
drive:

- filesystem creation and existence checks;
- collision detection for new plan names, which currently only checks
  `<projectRoot>/spec/<name>`;
- write-boundary enforcement and blocker text;
- `Spec:` commit-body markers and any code that parses them for attribution or
  plan meta-commit grouping;
- PR body header links and human-facing resume/run commands.

There is also a likely follow-on scope decision around cleanup and legacy plan
artifacts. Existing docs note that `jarvis1 cleanup` and older completed-plan
behavior still reason about `spec/<name>` and `spec/completed/...`. The draft
should decide whether that compatibility surface is in scope for this change or
explicitly out of scope for a later spec, because moving new Jarvis-internal
plan trees to `v1/spec/...` without a decision there could leave post-merge
cleanup/archive behavior inconsistent even if authoring and resume flows work.

The safest draft framing is probably:

- new Jarvis-repo committed spec authoring defaults to `v1/spec/...`;
- legacy root `spec/...` trees in this repo remain readable and resumable;
- generic target repos still default to `spec/...`;
- any remaining root-`spec` assumptions in cleanup/archive code are either
  updated as part of the same source-of-truth change or called out as an
  intentional non-goal with a documented follow-up.
