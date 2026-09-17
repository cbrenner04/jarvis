# Spec Guidance for Operators

Stable guidance for operators authoring and running Jarvis specs. Agent contracts (index shape, subspec sections, acceptance-criteria rules): [`spec-guidance-agent-core.md`](./spec-guidance-agent-core.md), which the harness injects into plan and intent prompts.

## Spec location conventions

### In-repo specs (committed)

Specs authored by `jarvis run workflow plan` under `projects.<key>.specs: "repo"` live inside the target repository under the configured **target directory** with a filesystem-safe UTC timestamp prefix and a descriptive slug:

`<targetDir>/<UTC-timestamp>-<slug>/`

For the jarvis project `<targetDir>` is `v2/spec` (project `plan.targetDir`); per-run `--target-dir` has highest precedence, then the seed's or ready-intent's canonical parent, then project config, then `spec`. Precedence detail: [`workflow-runner.md`](./workflow-runner.md#authoring-helper-and-presets). Plan branches stay untimestamped (`plan/<name>` under `~/.jarvis/worktrees`) even though files land under the timestamped directory.

### External specs (no-commit)

Projects with `specs: "external"` (the default) keep planning artifacts in Jarvis-owned storage: `~/.jarvis/specs/<project-safe-id>/` (seeds, ready-intents, `plans/<name>/`, `plans/completed/<name>/`). These specs are not committed to the target directory; they are ready to run immediately and remain for reference and re-runs. Home layout: [`install-and-config.md` § External specs home](./install-and-config.md#external-specs-home).

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

Index links may carry trailing annotations, such as `- [ ] [Work](./00-work.md) (after 00)`. Publication extracts the checkbox link and ignores the annotation; leading prose before the checkbox remains invalid. Missing-link failures distinguish absent file references from mentions without a parseable checkbox link.

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

`intent` splits one seed into reviewed, one-per-surface ready-intents under `<targetDir>/ready-intents/` and opens a draft PR. `plan` consumes one ready-intent into a spec tree conforming to the agent core (index with H1 and task list, numbered subspecs each with an exact `## Acceptance criteria` section), runs its review passes, and opens a draft PR. The plan agent authors the numbered subspecs; Jarvis validates their shape and index links but runs no post-hoc surface split. Both commands accept `--target-dir <dir>`. Preset contracts and flags: [`workflow-runner.md`](./workflow-runner.md).

For an independent intent with no prerequisites, leave the `## Prerequisites` body empty or write `none`; landing normalizes a `none`/`None.` body to empty.

### One artifact per bullet

A bullet under `## Acceptance criteria`, `## Decisions`, or `## Documentation updates` may name at most one backticked repo-relative artifact path claimed as built or changed; a bullet naming more than one is refused. Two wording-based exemptions apply regardless of section:

- **Stays-unchanged**: several artifacts named as staying unchanged, with no build verb anywhere in the bullet. Example: "`a.test.ts` and `b.test.ts` missing-gate projections stay green (shape unchanged by the mapping change)."
- **Shared decision**: one outcome stated to hold identically across several artifacts, rather than a distinct build claim per artifact (marker: "identical" or "the same"). Example: "Both `x.ts` and `y.ts` take the identical resolved path from one builder-local binding."

Wording that matches neither exemption is refused (fail closed). A bullet mixing stays-unchanged wording with a genuine build claim on a second artifact is still refused.

A backticked token containing glob syntax (`*`, `?`, or a bracketed character class) names a file convention rather than a concrete artifact, not a counted artifact path. It may accompany the one concrete artifact that the bullet builds or changes.

A slash-free backticked token that begins with `.` and has a second `.` later (`.test-support.ts`, the un-starred form of the `*.test-support.ts` glob convention) is a bare extension or naming-convention suffix, not a counted artifact path. A single-dot root dotfile (`.gitignore`) has no second dot, so it is untouched by this rule and stays excluded solely by the existing extension allowlist.

Paths named inside a `rules out` clause are mentions, not artifacts, in any section. The clause runs from `rules out` to the end of the bullet, or to an earlier `;` or ` — ` (em dash), whichever comes first — so a trailing clause after the semicolon or dash still counts as a build claim. Example: "builds `a.ts` — rules out `b.ts`; adds `c.ts`" still names two artifacts (`a.ts`, `c.ts`); `b.ts` is exempt.

In an `## Acceptance criteria` bullet only, a test path plus the production path it covers counts as one artifact: the test filename must match `<stem>.test.<ext>` and share a directory with a production file named `<stem>.<ext>`. Example: "`shared/state.ts` persists daemon state covered by `shared/state.test.ts`" names one artifact. A path left unpaired still counts on its own, so naming two production paths plus a test covering only one of them still names two artifacts. The collapse does not apply under `## Decisions` or `## Documentation updates` — the same pairing there still names two artifacts.

Review the generated index and subspecs on the PR; edit the files directly if needed, then merge. Once merged, the spec is available to `implement`. Plan-generated specs follow the same merge-first rule.

When work starts from a structured index (a feature checklist, a work queue): treat the item plus matching context docs as source input, write a concise build brief, draft with `intent`/`plan`, implement with `implement`. Do not frame work-start prompts as "draft a spec" — done is merged implementation code, not generated spec artifacts.
