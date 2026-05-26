# Spec Guidance for Agents

This file is stable guidance for agents that need to create or work from
Jarvis specs.

## Spec location conventions

### In-repo specs (committed)

Specs authored with `jarvis1 plan` under `modes.plan.commit: true` (the default) live inside the target repository under a configured **root directory** (default `spec`) with directories whose **basename** includes a filesystem-safe UTC timestamp prefix and a descriptive slug:

`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<slug>/`

where `<targetDir>` defaults to `spec` (canonical layout: `spec/YYYY-MM-DDTHH-mm-ssZ-<slug>/`). Repositories can override the root with a per-project `plan.targetDir` setting (see [config.md](./config.md#targetdir-plan-mode-committrue-only) for details). For example, a repository might use `v1/spec/YYYY-MM-DDTHH-mm-ssZ-<slug>/` if configured with `plan.targetDir = "v1/spec"`. You can also override per run with `jarvis1 plan --target-dir <dir> ...` (same validation and highest precedence for that run).

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

repo: https://github.com/owner/target-repo

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

Run Jarvis against the index:

```sh
jarvis1 run spec/2026-05-17T22-14-03Z-my-feature/index.md
```

Specs may live anywhere. The `repo:` line is **optional** for in-repo specs (since the spec location implies the target repo), but **required** for external specs authored with `modes.plan.commit: false` (since the spec path no longer resides inside the target directory). When present, `repo:` identifies the target repository in a portable way. Accepted forms:

- HTTPS URL: `https://github.com/owner/repo[.git]`
- SSH URL: `git@github.com:owner/repo[.git]`
- Slug: `owner/repo` (interpreted as `github.com/owner/repo`)
- Registered project key (local-only, not portable across machines)

Jarvis resolves the target repo at run time in this order:

1. `--repo <name|path|url>` flag passed on the command line.
2. Spec `repo:` matches a registered project's key, or URL/slug loose-matched
   against the `origin` URLs of registered projects.
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

## Authoring with `jarvis1 plan`

When using `jarvis1 plan [<intent-file|"inline text">]` to generate a spec, plan mode produces specs that conform to the conventions documented in this file: an `index.md` file with an H1 title and a GitHub-style task list of links to atomic subspecs, plus numbered subspec files (`00-*.md`, `01-*.md`, etc.) each with an exact `## Acceptance criteria` section containing checkboxes.

The generated spec tree is opened as a draft PR for review and editing. After you review the generated index and subspecs on the PR, you can edit the files directly (plan mode preserves manual edits across review passes) and merge the PR to `main`. Once merged, the spec becomes available to `jarvis1 run` for implementation work.

Plan-mode prompts forbid self-referential deliverables: do not write acceptance criteria that only grade prose inside the active spec directory. Criteria must verify target state outside that directory (code, tests, docs, operator behavior, or generated evidence).

Plan mode also supports no-argument sessions (`jarvis1 plan`) for fuzzy intents:
Jarvis seeds `intent.md` with `# Intent`, then runs a non-interactive
intent-refinement pass before drafting. The agent can append inferred scope,
assumptions, risks, or a visible `## Blocker` if human clarification is needed;
it does not ask questions live.

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

When operators start work from a phase checklist (for example `v2/spec/v2-meta-index.md`), the workflow semantics are:

1. Treat the phase line plus matching build-order section as source input.
2. Write a concise build brief for the implementation to ship.
3. Use `jarvis1 plan "<build brief>"` as the drafting step.
4. Use `jarvis1 run ...` as the implementation step.

Do not frame phase-start prompts as "draft a spec." Phase done is merged implementation code, not generated intent/spec artifacts.

## Subspecs

Each subspec should be independently implementable and testable. A good subspec
has:

- the problem or behavior it covers
- decisions needed to keep the work bounded
- a task checklist for that one slice of work
- acceptance criteria
- required documentation updates

Keep subspecs atomic. If one unchecked item requires unrelated code paths,
multiple product decisions, or verification that cannot run independently, split
it into separate numbered subspec files and link each one from `index.md`.

Subspec heading contract (enforced by patch mode parser):
- Acceptance criteria must use the exact heading `## Acceptance criteria`.
- Blockers must use the exact heading `## Blocker`.
- Variants like `### Acceptance criteria` or `## acceptance criteria` are rejected.

## Agent Workflow

When an agent is asked to work from a Jarvis spec:

1. Read the target repo guidance first.
2. Read the spec directory's `index.md` (`spec/<timestamp>-<slug>/index.md` or a
   legacy untimestamped directory).
3. Pick the single most important unchecked subspec from the index.
4. Read that subspec before editing.
5. Complete only that subspec.
6. Run the verification required by the subspec and repo guidance.
7. Check only that subspec's checkbox in `index.md`.

Do not check unrelated index items. Do not keep working through the rest of the
index after one subspec is complete.

## Non-index spec handling

Passing a non-index spec to `jarvis1 run`, such as `spec/2026-05-17T22-14-03Z-my-feature/01-task.md`,
prompts for one of these actions:

- `s`: switch to a sibling `index.md` and run the normal loop from there (only
  offered when a sibling `index.md` exists)
- `e`: exit without running an agent

Normal implementation work should run from `index.md`.
