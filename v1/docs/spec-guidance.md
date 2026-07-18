# Spec Guidance for Agents

This file is stable guidance for agents that need to create or work from
Jarvis specs.

## Spec location conventions

### In-repo specs (committed)

Specs authored with `jarvis1 plan` or `jarvis1 intent` under `modes.plan.commit: true` (the default) live inside the target repository under a configured **root directory** with directories whose **basename** includes a filesystem-safe UTC timestamp prefix and a descriptive slug:

`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<slug>/`

**Route by target:** v1 work (seeds and committed specs) lives under `v1/spec/`; genuine v2 planning under `v2/spec/`; a spec touching both surfaces routes to `v1/spec` (shipping surface wins). The default `plan.targetDir` for the jarvis project is `v1/spec`; v2 planning is authored with explicit `--target-dir v2/spec` override (available on both `jarvis1 plan --target-dir <dir>` and `jarvis1 intent --target-dir <dir>`).

For repositories using the route-by-target pattern, `<targetDir>` is either `v1/spec` (the default for v1 work) or `v2/spec` (for v2-only planning with the explicit override). Repositories can also override the root with a per-project `plan.targetDir` setting (see [config.md](./config.md#targetdir-plan-mode-committrue-only) for details); per-run `--target-dir` has highest precedence.

The prefix converts `Date.prototype.toISOString()` (`:` → `-`, no milliseconds): for
example `2026-05-17T22-14-03Z-my-feature`. Omitting the timestamp matches older
trees and remains valid on disk — jarvis reads whatever path you pass (`jarvis1
run`, resume, cleanup) — but **new specs should adopt the prefixed form so same-day
trees sort and collide predictably.**

Plan-generated specs under `commit: true` already use `spec/<timestamp>-<validated-plan-name>/`. The
**plan branch and worktree** stay untimestamped: `plan/<plan-name>` with
`.worktree/plan-<plan-name>/` even when files live under
`spec/2026-05-17T22-14-03Z-<plan-name>/`.

### External specs (no-commit)

Specs authored with `jarvis1 plan` under `modes.plan.commit: false` live in Jarvis-owned storage outside the target directory:

`~/.jarvis/specs/<project-safe-id>/YYYY-MM-DDTHH-mm-ssZ-<slug>/`

The target directory must be a registered project (via `jarvis1 init` or `jarvis1 config`); it may or may not be a git repository. The `<project-safe-id>` is the registered project key (e.g., `groceries`), a derived slug from the origin URL, or the repo root basename. For example:

```text
~/.jarvis/specs/groceries/2026-05-17T22-14-03Z-my-feature/index.md
~/.jarvis/specs/groceries/2026-05-17T22-14-03Z-my-feature/intent.md
~/.jarvis/specs/groceries/2026-05-17T22-14-03Z-my-feature/00-first-task.md
```

These specs are **not committed to the target directory**. They are Jarvis-owned artifacts that include a `repo:` binding to their target directory so `jarvis1 run` can later resolve the correct checkout.

**Key difference:** In-repo specs are typically created as part of the work (authored collaboratively, merged to `main`, then implemented). External no-commit specs are generated and ready to run immediately — they live in Jarvis storage and remain there for reference and re-runs.

Jarvis specs should use an index-routed shape:

```text
spec/YYYY-MM-DDTHH-mm-ssZ-<slug>/index.md
spec/YYYY-MM-DDTHH-mm-ssZ-<slug>/00-first-task.md
spec/YYYY-MM-DDTHH-mm-ssZ-<slug>/01-second-task.md
```

The `index.md` file is the routing file. It contains a GitHub-style task list
whose items link to atomic subspec files:

```md
# <Feature>

repo: owner/target-repo

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

External specs (`commit: false`) may also use `repo: <https://example.com/repo>` when the origin is not a GitHub slug.

Run Jarvis against the index:

```sh
jarvis1 run spec/2026-05-17T22-14-03Z-my-feature/index.md
```

Specs may live anywhere. The `repo:` line is **optional** for in-repo specs (since the spec location implies the target repo), but **required** for external specs authored with `modes.plan.commit: false` (since the spec path no longer resides inside the target directory). When present, `repo:` identifies the target repository in a portable way. Accepted forms:

- HTTPS URL: `https://github.com/owner/repo[.git]` (or angle-bracket wrapped: `repo: <https://…>`)
- SSH URL: `git@github.com:owner/repo[.git]`
- Slug: `owner/repo` (interpreted as `github.com/owner/repo`; preferred canonical form for GitHub)
- Registered project key (local-only, not portable across machines)

Jarvis resolves the target repo at run time in this order:

1. `--repo <name|path|url>` flag passed on the command line.
2. Spec `repo:` matches a registered project's key, or URL/slug loose-matched
   against the `origin` URLs of registered projects. An unresolvable value
   (relative path or bareword) is deferred; resolution continues to steps 3/4,
   and the spec is run against that location if found. Only if steps 3/4 also
   fail is the unresolvable value reported as an error.
3. Spec path lives inside a registered project's root.
4. Spec path lives inside any git checkout (used in ad-hoc mode; jarvis does
   not persist anything to config).
5. Otherwise jarvis prompts (or exits with a usage error in non-TTY runs).

See [run-loop.md](./run-loop.md#iteration) for the authoritative description
of resolution, the disambiguation prompt, completion semantics, and the
`--cwd` flag.

Legacy `repo: <absolute-local-path>` is still honored only when the path
exactly equals a registered project's root; otherwise it is ignored. New
specs should use the URL or slug form so they remain portable across
machines and operators.

If the resolved target — whether selected via `repo:`, `--repo`, a registered
project, or the ad-hoc git-checkout walk — points at a directory that no
longer exists on disk, `jarvis1 run` exits 1 with a named preflight error
identifying the missing path and the resolution source rather than the
historical worktree-flavored "posix_spawn 'gh'" failure. See
[run-loop.md](./run-loop.md#preflight-checks).

## Land the spec before implementing it

New specs must be merged to `main` before any implementation work on them
begins. Jarvis runs against the spec file on disk, so a spec that only exists
on a feature branch will drift from whatever the implementation branch
eventually does. The workflow is:

1. Create the spec on a branch and open a PR with **only** the spec files.
2. Get the spec PR merged.
3. Start a separate run/branch (typically via `jarvis1 run`) for the
   implementation work.

Do not bundle spec authoring and implementation in the same PR.

`jarvis1 plan` is one way to author specs; the merge-first
rule applies to plan-generated specs the same as hand-written ones.

## Plan same-seam siblings serially

Sibling seeds/intents that edit the same code seam must be planned (and run) one
at a time, each against the merged result of the previous one — never fanned out
in parallel off a shared base. Parallel-planned siblings encode the pre-fix
vocabulary and structure of that base; the first sibling to land renames or
reshapes the seam and stales every other spec, which then has to be pruned and
re-planned (observed on the publication/ready-finalize cluster, PR #1620).
Parallel fan-out is fine across disjoint seams.

## Authoring with `jarvis1 plan` or `jarvis1 intent`

When using `jarvis1 plan <intent-file|"inline text">` or `jarvis1 intent <intent-text>` to generate a spec, both tools produce specs that conform to the conventions documented in this file: an `index.md` file with an H1 title and a GitHub-style task list of links to atomic subspecs, plus numbered subspec files (`00-*.md`, `01-*.md`, etc.) each with an exact `## Acceptance criteria` section containing checkboxes.

Both `jarvis1 plan` and `jarvis1 intent` accept the `--target-dir <dir>` override to route specs to a target directory (e.g., `--target-dir v2/spec` for v2-only planning, per the route-by-target pattern documented above).

The generated spec tree is opened as a draft PR for review and editing. After you review the generated index and subspecs on the PR, you can edit the files directly (plan mode preserves manual edits across review passes) and merge the PR to `main`. Once merged, the spec becomes available to `jarvis1 run` for implementation work.

Plan-mode prompts forbid self-referential deliverables: do not write acceptance criteria that only grade prose inside the active spec directory. Criteria must verify target state outside that directory (code, tests, docs, operator behavior, or generated evidence).

Fresh plan runs require a seed. File and inline seeds both enter the same flow:
jarvis seeds `intent.md`, preserves the exact raw seed in a dedicated block,
runs one non-interactive intent-draft pass to shape the editable draft and
propose `name:`, then continues with the normal plan pipeline.

When a seed is too broad for one spec/PR, split it into authored intents first.
Use these size boundaries:

- A **subspec** is commit-sized: one atomic, independently testable change.
- An **intent** is behavior-sized: one independently observable behavior that
  can later draft into one spec.
- A **spec** is PR-sized: one reviewable unit made of one or more subspecs.

Treat reviewability as a warning, not a hard cap: if one spec looks likely to
land around ~1000 changed lines including tests and docs, split earlier into
multiple behavior-sized intents/specs rather than stretching one PR.

For intent files, `seeds/` is the open raw-seed queue and `ready-intents/` is
the open authored-intent queue. Successful promotion consumes a file seed:
committed mode deletes its worktree copy in the split commit, while no-commit
mode deletes it only after every ready-intent is written. Failed promotions
leave it queued. Fan-out writes reviewed, behavior-level intents to
`ready-intents/`; later `jarvis1 plan` runs consume those intents one at a
time.

### Intent prerequisites

Authored intents may declare a `## Prerequisites` section listing dependencies: existing code paths, documented behaviors, or shared infrastructure the new spec depends on (e.g., "quota fallback is implemented", "the workspace contains a config file with a `modes` key"). During plan mode's draft phase, the agent checks the target repo to confirm each prerequisite is observable in committed code, tests, or docs. If all prerequisites are cleanly confirmed, drafting proceeds normally. If any prerequisite cannot be clearly confirmed, the agent appends a `## Blocker` section to `intent.md` naming the unconfirmed behavior, writes no spec files, and plan exits non-zero; the operator must resolve the missing behavior or revise the intent. An empty or bareword-`none` `## Prerequisites` body skips the gate entirely and drafting proceeds immediately.

Prerequisites are validation gates, not just context: they ensure every work item lands on a firm foundation. Use this section only for critical dependencies that genuinely block the spec's design (e.g., "v1 quota classification exists" for a plan refactoring it). Do not use prerequisites as a generic checklist of nice-to-haves or incidental reading materials — keep them minimal and specific to the intent's scope.

Plan-generated specs follow the same merge-first rule: do not run `jarvis1 run` against the spec until after the plan PR is merged to `main`.

When you iterate with
`jarvis1 plan --resume <targetDir>/2026-05-17T22-14-03Z-my-plan/index.md` (or a legacy
`<targetDir>/<plan-name>/index.md`), resume review commits add an `r<n>` suffix
(`plan: review 3 r1`, `plan: review 4 r1`, then `... r2` on a later resume
invocation). The timestamp (when present) is **only** in the spec directory path;
resume still attaches to **`plan/<plan-name>`** and `.worktree/plan-<plan-name>/`.
For a default repository this is `spec/…`; for a configured root this is e.g. `v1/spec/…`.
From `jarvis1 run`'s perspective, hand-edited specs and plan-generated specs are
equivalent once merged to `main`.

When operators start work from a structured index (such as a feature checklist or work queue), the workflow semantics are:

1. Treat the work item plus matching context docs as source input.
2. Write a concise build brief for the implementation to ship.
3. Use `jarvis1 plan "<build brief>"` as the drafting step.
4. Use `jarvis1 run ...` as the implementation step.

Do not frame work-start prompts as "draft a spec." Done is merged implementation code, not generated intent/spec artifacts.

## Subspecs

Each subspec should be independently implementable and testable. A good subspec
has:

- the problem or behavior it covers
- decisions needed to keep the work bounded
- a task checklist for that one slice of work
- acceptance criteria
- required documentation updates

Any spec that changes **existing functionality** (not purely net-new work) must
include updating `v2/docs/v1-behaviors.md` in its documentation updates — that
catalog is the v1 parity baseline v2 review reads, so a behavior change that
skips it silently rots the baseline. Record what the behavior now is, so the v2
plans can later be reconciled against it.

Keep subspecs atomic. If one unchecked item requires unrelated code paths,
multiple product decisions, or verification that cannot run independently, split
it into separate numbered subspec files and link each one from `index.md`.

### Behavioral acceptance criteria

Acceptance criteria describe **observable operator or runtime behavior** — what
an implementer or reviewer can verify without mandating incidental layout.

- **Product specs** (target-repo work): state outcomes ("quota exhaustion falls
  through to the next configured agent", "a failed ready gate leaves the PR
  draft"). Stay silent on schema, tables, files, modules, and shapes unless the
  structure *is* the contract (public API surface, wire format, on-disk artifact
  the operator must find).
- **Harness subspecs** (jarvis repo work): may name hooks, telemetry fields,
  prompt IDs, and internal symbols when structure is the contract.

Good (product):

```md
- [ ] Quota exhaustion during patch run falls through to the next configured agent.
```

Bad (product):

```md
- [ ] Quota classification lives in a dedicated module with unit tests.
```

Good (harness, structure is the contract):

```md
- [ ] `patch_phase: "shrink"` is excluded from implementation iteration counts in run summary.
```

#### Behavior-preserving (refactor) ACs: cite the test, don't paraphrase

**Refactor / preservation ACs only.** When an AC's contract is "behavior is unchanged" (a refactor, extraction, or move), write it as **"`<existing-test>` stays green"** — cite the pinning test or source path — instead of paraphrasing what that test asserts. Paraphrasing is where wrong claims enter: an author who restates assumed behavior can assert a falsehood a pre-existing test already disproves (this is what produced the shared-invocation-executor spec defect, where an AC said plan "stops on a hard error" while `plan-draft-hard-error-continue.test.ts` proved the opposite). Writing the AC as a citation forces the author to locate the test and surfaces the real behavior.

Good (refactor):

```md
- [ ] `run.test.ts` review-phase + draft-PR tests stay green (behavior unchanged by the extraction).
```

Bad (refactor — paraphrases behavior the author didn't verify):

```md
- [ ] Plan stops on a hard error.
```

This is **refactor-only** and must not be read as "every AC cites a test." New-behavior ACs are explicitly exempt — they keep the prose form above, backed by *new* tests; requiring them to cite a pre-existing test is nonsensical because the behavior is new. The plan-draft validator enforces this automatically: a preservation/continuation AC (verbs like `preserved`, `unchanged`, `stays`, `stops`, `continues`) that carries no path-like test/source anchor produces a non-blocking `missing-anchor-behavioral-ac` warning at draft time.

#### Failing-test requirement for runtime-behavior subspecs

Every subspec that changes runtime behavior must carry an acceptance criterion naming a test that fails against the pre-fix code and passes after the change. This ensures every behavior change lands with a failing-test surface that motivates and validates the work. The test may be newly written or an existing test that was updated to expect new behavior; either way, the AC must name a test that would fail against the baseline and pass against the implementation. "Existing tests stay green" does not satisfy this requirement; that is a preservation criterion (cite it using the refactor AC pattern above), not evidence of new behavior. Docs-only and spec-only subspecs are exempt — only runtime-behavior changes require the failing-test AC.

Good (new behavior):

```md
- [ ] A regression test drives the implement workflow to a `blocked` outcome against a real git fixture and asserts worktree, branch, registration, and uncommitted work survive; it fails against the pre-fix code.
```

Bad (does not name the test):

```md
- [ ] Tests pass.
```

Bad (preservation AC written as new behavior):

```md
- [ ] Quota exhaustion falls through to the next configured agent.
```

The good example is from the `blocked-run-retains-worktree-and-branch` spec.

#### Human-only acceptance criteria

An acceptance criterion is classified as **human-only** if its text ends with (after trimming trailing whitespace and a single trailing period) one of these markers: `(Manual)`, `visual inspection only`, or `no automated guard` (case-insensitive, whole-phrase match). Human-only criteria describe verification that the harness cannot automate — manual inspection, live testing, or external approval.

Human-only criteria do not block subspec completion. A run completes as soon as all **non-human-only** criteria are checked; unchecked human-only criteria remain for human verification after the run finishes. The run summary reflects this by labeling unchecked human-only criteria as "human-verify" rather than treating them as blockers (e.g., `4/7 (3 human-verify)` indicates 4 automated criteria checked, 7 total, 3 human-only unchecked).

Use human-only criteria sparingly and only when the verification genuinely cannot be automated:

Good (human-only):
```md
- [ ] The feature works in the live iOS simulator. (Manual)
- [ ] No visual regressions on the redesigned dashboard. (visual inspection only)
```

Bad (should be automated):
```md
- [ ] The code follows team conventions. (no automated guard)
```

(Conventions should have linters; if they don't, add one rather than marking them human-only.)

#### Agent-verifiable acceptance criteria

An acceptance criterion that is not marked human-only must be verifiable from the implement agent's worktree environment **without network or GitHub access**. The implement agent runs in isolation and cannot interact with pull requests, CI status, reviews, or other GitHub/network resources.

Do not write non-human-only ACs that assert:
- PR body or title content ("PR body lists the breaking changes", "pull request describes the change")
- CI status ("CI is green", "all checks pass", "workflow succeeds")
- Review or merge-readiness state ("review is approved", "ready gate passes", "PR is reviewed")
- PR merge or approval status ("is merged", "is approved")

These assertions can only be verified after the spec is complete, when a human publishes the PR or looks at CI results. If post-merge evidence is necessary (e.g., "PR body documents the decision"), that belongs in publication records (`prNarrative`, PR templates, release notes), not in acceptance criteria that strand an implement run at `blocked` when the agent cannot tick them.

**Escape hatch:** If verification truly cannot be automated, mark the criterion human-only with `(Manual)`, `visual inspection only`, or `no automated guard` to indicate post-merge human verification. The harness then removes it from automated completion requirements.

Good (satisfiable):
```md
- [ ] Quota exhaustion falls through to the next configured agent.
- [ ] Tests pass when the feature is disabled.
- [ ] `run.test.ts` stays green.
```

Bad (unsatisfiable, will strand implement at blocked):
```md
- [ ] CI is green.
- [ ] PR body lists the test-count change.
- [ ] Review is approved.
```

Fix by appending `(Manual)` to each (human-only escape), or rewriting as a satisfiable worktree-verifiable outcome.

Subspec heading contract (enforced by patch mode parser):
- Acceptance criteria must use the exact heading `## Acceptance criteria`.
- Blockers must use the exact heading `## Blocker`.
- Variants like `### Acceptance criteria` or `## acceptance criteria` are rejected.

## Agent Workflow

When an agent is asked to work from a Jarvis spec during a patch run:

1. Read the harness-injected repo guidance and active subspec in the prompt.
2. Execute only that active subspec.
3. Run the verification required by the subspec and repo guidance.
4. Tick only that subspec's acceptance criteria under `## Acceptance criteria`.

The harness selects the active linked subspec for index-routed runs; patch
agents do not pick the first unchecked subspec from `index.md`. Jarvis flips
the index checkbox when all acceptance criteria in a subspec are checked.

Do not check unrelated index items. Do not keep working through the rest of the
index after one subspec is complete.

## Non-index spec handling

Passing a non-index spec to `jarvis1 run`, such as `spec/2026-05-17T22-14-03Z-my-feature/01-task.md`,
prompts for one of these actions:

- `s`: switch to a sibling `index.md` and run the normal loop from there (only
  offered when a sibling `index.md` exists)
- `e`: exit without running an agent

Normal implementation work should run from `index.md`.
