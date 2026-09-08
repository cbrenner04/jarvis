# Spec Guidance for Operators

Stable guidance for operators authoring and running Jarvis specs. Agent contracts (index shape, subspec sections, acceptance-criteria rules): [`spec-guidance-agent-core.md`](./spec-guidance-agent-core.md), which the harness injects into plan and intent prompts.

## Spec location conventions

### In-repo specs (committed)

Specs authored by `jarvis run workflow plan` under effective `plan.commit: true` (the default) live inside the target repository under the configured **target directory** with a filesystem-safe UTC timestamp prefix and a descriptive slug:

`<targetDir>/<UTC-timestamp>-<slug>/`

For the jarvis project `<targetDir>` is `v2/spec` (project `plan.targetDir`); per-run `--target-dir` has highest precedence, then the seed's or ready-intent's canonical parent, then project config, then `spec`. Precedence detail: [`workflow-runner.md`](./workflow-runner.md#authoring-helper-and-presets). Plan branches stay untimestamped (`plan/<name>` under `~/.jarvis/worktrees`) even though files land under the timestamped directory.

### External specs (no-commit)

Projects whose effective Git publication is disabled (`git: false` or `plan.commit: false`) keep planning artifacts in Jarvis-owned storage: `~/.jarvis/specs/<project-safe-id>/` (seeds, ready-intents, `plans/<name>/`, `plans/completed/<name>/`). These specs are not committed to the target directory; they are ready to run immediately and remain for reference and re-runs. Home layout: [`install-and-config.md` § External specs home](./install-and-config.md#external-specs-home).

### Index-routed shape

```text
<targetDir>/<UTC-timestamp>-<slug>/index.md
<targetDir>/<UTC-timestamp>-<slug>/00-first-task.md
<targetDir>/<UTC-timestamp>-<slug>/01-second-task.md
```

`index.md` is the routing file: a GitHub-style task list whose items link to atomic subspec files. An optional `repo: owner/target-repo` line names the target repository portably (HTTPS URL, SSH URL, or slug); the harness resolves the project from the registry (`jarvis init`), so the line is metadata, not routing.

```md
# <Feature>

repo: owner/target-repo

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

During plan-draft the agent writes to `.jarvis-plan-stage/` in the worktree before landing to the durable path; staging accepts flat files or exactly one nested `spec/<name>/` tree, flattened before normalization. Implement runs target `index.md` (`jarvis run workflow implement --spec <index.md>`), never a subspec directly.

## Land the spec before implementing it

New specs must be merged to `main` before implementation begins. Jarvis runs against the spec on disk, so a spec that exists only on a feature branch drifts from whatever the implementation branch does:

1. Create the spec on a branch and open a PR with **only** the spec files.
2. Merge the spec PR.
3. Start a separate implement run for the implementation work.

Do not bundle spec authoring and implementation in one PR. The merge-first rule applies to plan-generated specs the same as hand-written ones.

## Plan same-seam siblings serially

Sibling seeds/intents that edit the same code seam must be planned (and implemented) one at a time, each against the merged result of the previous one — never fanned out in parallel off a shared base. Parallel-planned siblings encode the pre-fix vocabulary of that base; the first to land reshapes the seam and stales every other spec (observed on the publication/ready-finalize cluster, PR #1620). Parallel fan-out is fine across disjoint seams.

## Authoring with `jarvis run workflow intent` and `plan`

`intent` splits one seed into reviewed, one-per-surface ready-intents under `<targetDir>/ready-intents/` and opens a draft PR. `plan` consumes one ready-intent into a spec tree conforming to the agent core (index with H1 and task list, numbered subspecs each with an exact `## Acceptance criteria` section), runs its review passes, and opens a draft PR. Both accept `--target-dir <dir>`. Preset contracts and flags: [`workflow-runner.md`](./workflow-runner.md).

Review the generated index and subspecs on the PR; edit the files directly if needed, then merge. Once merged, the spec is available to `implement`. Plan-generated specs follow the same merge-first rule.

When work starts from a structured index (a feature checklist, a work queue): treat the item plus matching context docs as source input, write a concise build brief, draft with `intent`/`plan`, implement with `implement`. Do not frame work-start prompts as "draft a spec" — done is merged implementation code, not generated spec artifacts.
