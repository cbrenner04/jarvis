# Spec Guidance for Operators

This file is stable guidance for operators authoring and running Jarvis specs via the CLI. Agent contracts: [spec-guidance-agent-core.md](../../v2/docs/spec-guidance-agent-core.md).

## Spec location conventions

### In-repo specs (committed)

Specs authored with `jarvis1 plan` or `jarvis1 intent` under `modes.plan.commit: true` (the default) live inside the target repository under a configured **root directory** with directories whose **basename** includes a filesystem-safe UTC timestamp prefix and a descriptive slug:

`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<slug>/`

**Route by target:** new jarvis-repo specs default to `v2/spec/` (the jarvis project `plan.targetDir`); `v1/spec/` is only for genuine v1 maintenance fixes, authored with explicit `--target-dir v1/spec` (available on both `plan` and `intent`).

For repositories using the route-by-target pattern, `<targetDir>` is either `v2/spec` (the default) or `v1/spec` (maintenance fixes, explicit override). Repositories can also override the root with a per-project `plan.targetDir` setting (see [config.md](./config.md#targetdir-plan-mode-committrue-only) for details); per-run `--target-dir` has highest precedence.

The prefix converts `Date.prototype.toISOString()` (`:` → `-`, no milliseconds): for example `2026-05-17T22-14-03Z-my-feature`. Omitting the timestamp matches older trees and remains valid on disk — jarvis reads whatever path you pass (`jarvis1 run`, resume, cleanup) — but **new specs should adopt the prefixed form so same-day trees sort and collide predictably.**

Plan-generated specs under `commit: true` already use `spec/<timestamp>-<validated-plan-name>/`. The **plan branch and worktree** stay untimestamped: `plan/<plan-name>` with `.worktree/plan-<plan-name>/` even when files live under `spec/2026-05-17T22-14-03Z-<plan-name>/`.

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

The `index.md` file is the routing file. It contains a GitHub-style task list whose items link to atomic subspec files:

```md
# <Feature>

repo: owner/target-repo

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

During v2 plan-draft, the agent writes to `.jarvis-plan-stage/` in the worktree before landing to the durable `<targetDir>/<timestamp>-<slug>/` path. Staging accepts either flat files at `.jarvis-plan-stage/{index.md,NN-*.md}` or exactly one nested tree at `.jarvis-plan-stage/spec/<name>/` with the same shape inside; the harness flattens nested staging to the root before normalization. Both forms land the same durable spec layout shown above.

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

See [run-loop.md](./run-loop.md#iteration) for the authoritative description of resolution, the disambiguation prompt, completion semantics, and the `--cwd` flag.

Legacy `repo: <absolute-local-path>` is still honored only when the path exactly equals a registered project's root; otherwise it is ignored. New specs should use the URL or slug form so they remain portable across machines and operators.

If the resolved target — whether selected via `repo:`, `--repo`, a registered project, or the ad-hoc git-checkout walk — points at a directory that no longer exists on disk, `jarvis1 run` exits 1 with a named preflight error identifying the missing path and the resolution source rather than the historical worktree-flavored "posix_spawn 'gh'" failure. See [run-loop.md](./run-loop.md#preflight-checks).

## Land the spec before implementing it

New specs must be merged to `main` before any implementation work on them begins. Jarvis runs against the spec file on disk, so a spec that only exists on a feature branch will drift from whatever the implementation branch eventually does. The workflow is:

1. Create the spec on a branch and open a PR with **only** the spec files.
2. Get the spec PR merged.
3. Start a separate run/branch (typically via `jarvis1 run`) for the
   implementation work.

Do not bundle spec authoring and implementation in the same PR.

`jarvis1 plan` is one way to author specs; the merge-first rule applies to plan-generated specs the same as hand-written ones.

## Plan same-seam siblings serially

Sibling seeds/intents that edit the same code seam must be planned (and run) one at a time, each against the merged result of the previous one — never fanned out in parallel off a shared base. Parallel-planned siblings encode the pre-fix vocabulary and structure of that base; the first sibling to land renames or reshapes the seam and stales every other spec, which then has to be pruned and re-planned (observed on the publication/ready-finalize cluster, PR #1620). Parallel fan-out is fine across disjoint seams.

## Authoring with `jarvis1 plan` or `jarvis1 intent`

When using `jarvis1 plan <intent-file|"inline text">` or `jarvis1 intent <intent-text>` to generate a spec, both tools produce specs that conform to the conventions documented in [spec-guidance-agent-core.md](../../v2/docs/spec-guidance-agent-core.md): an `index.md` file with an H1 title and a GitHub-style task list of links to atomic subspecs, plus numbered subspec files (`00-*.md`, `01-*.md`, etc.) each with an exact `## Acceptance criteria` section containing checkboxes.

Both `jarvis1 plan` and `jarvis1 intent` accept the `--target-dir <dir>` override to route specs to a target directory (e.g., `--target-dir v2/spec` for v2-only planning, per the route-by-target pattern documented above).

The generated spec tree is opened as a draft PR for review and editing. After you review the generated index and subspecs on the PR, you can edit the files directly (plan mode preserves manual edits across review passes) and merge the PR to `main`. Once merged, the spec becomes available to `jarvis1 run` for implementation work.

After intent split fans out reviewed, one-per-surface intents to `ready-intents/`, later `jarvis1 plan` runs consume those intents one at a time.

Plan-generated specs follow the same merge-first rule: do not run `jarvis1 run` against the spec until after the plan PR is merged to `main`.

When you iterate with `jarvis1 plan --resume <targetDir>/2026-05-17T22-14-03Z-my-plan/index.md` (or a legacy `<targetDir>/<plan-name>/index.md`), resume review commits add an `r<n>` suffix (`plan: review 3 r1`, `plan: review 4 r1`, then `... r2` on a later resume invocation). The timestamp (when present) is **only** in the spec directory path; resume still attaches to **`plan/<plan-name>`** and `.worktree/plan-<plan-name>/`. For a default repository this is `spec/…`; for a configured root this is e.g. `v1/spec/…`. From `jarvis1 run`'s perspective, hand-edited specs and plan-generated specs are equivalent once merged to `main`.

When operators start work from a structured index (such as a feature checklist or work queue), the workflow semantics are:

1. Treat the work item plus matching context docs as source input.
2. Write a concise build brief for the implementation to ship.
3. Use `jarvis1 plan "<build brief>"` as the drafting step.
4. Use `jarvis1 run ...` as the implementation step.

Do not frame work-start prompts as "draft a spec." Done is merged implementation code, not generated intent/spec artifacts.

## Non-index spec handling

Passing a non-index spec to `jarvis1 run`, such as `spec/2026-05-17T22-14-03Z-my-feature/01-task.md`, prompts for one of these actions:

- `s`: switch to a sibling `index.md` and run the normal loop from there (only
  offered when a sibling `index.md` exists)
- `e`: exit without running an agent

Normal implementation work should run from `index.md`.
