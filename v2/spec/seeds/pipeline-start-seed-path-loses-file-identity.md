---
name: pipeline-start-seed-path-loses-file-identity
---

# `pipeline start --seed <path>` loses the seed file's identity

## Problem

`jarvis pipeline start <project> --seed <path>` resolves the path, reads the file, and puts the
**contents** into `PipelineContext.seed` (`v2/src/commands/pipeline.ts:281-289`). The intent stage
then builds its input as `seedText` (`pipeline-stage-resolve.ts` `resolveIntentStage`), which takes
the inline-seed branch of `resolveIntentSeed`
(`v2/src/execution/publication-workflow-steps.ts:200-202`):

```ts
const slug = slugify(content.split(/\s+/u).slice(0, 6).join(" "));
return { label: "inline seed", content, slug, name: slug, paths: [] };
```

The `--seed <path>` branch just above it (`:180-195`) derives `name` from the file basename and
returns `paths: [canonical]`. Routing a seed *file* through the text branch loses both.

Two operator-visible consequences, both reproduced 2026-07-31 on
`v2/spec/seeds/plan-draft-contract-swallows-the-normalizer-reason.md`:

1. **Garbage slug.** Seed files start with YAML frontmatter, so the first six words are
   `--- name: plan-draft-contract-swallows-the-normalizer-reason ---`. The pipeline branched,
   committed, titled its PR, and named its worktree
   `intent/name-plan-draft-contract-swallows-the-no` (#2366) — the literal frontmatter key
   leading the slug. The same seed through `jarvis run workflow intent --seed <path>` produces a
   correct basename slug.
2. **The seed is never consumed.** `paths: []` means the landing step has nothing to delete, so
   the seed file survives on `main` after its ready-intents land. That breaks the publication
   contract (a queue input is consumed once its durable output lands) and leaves the seed queue
   silently accumulating already-processed entries.

## Decisions

- `pipeline start --seed <path>` reaches `resolveIntentSeed` through the **path** branch, so slug,
  name, label, and `paths` match a standalone `jarvis run workflow intent --seed <path>` for the
  same file — rules out slug-fixing inside the text branch (e.g. stripping frontmatter), which
  would still leave `paths: []` and the seed unconsumed.
- `PipelineContext` carries the seed's project-relative **path** when the operator supplied one,
  distinct from `--seed-text` inline content; `--seed-text` keeps today's inline behavior
  unchanged — rules out overloading one `seed` field and guessing which it is.
- The seed path is resolved and validated at pipeline admission (same containment and
  is-a-file checks the standalone path performs), not at first stage dispatch — rules out
  admitting a pipeline that cannot resolve its own first input.
- Out of scope: the ready-intent → plan and plan → implement handoff (shipped, #2363), and the
  inline `--seed-text` slug heuristic itself.

## Acceptance criteria

- [ ] `jarvis pipeline start <project> --seed <path>` and `jarvis run workflow intent --seed <path>`
      produce the **same** slug, name, and label for the same seed file; a test drives both against
      a frontmatter-leading fixture and fails against the pre-fix code (which yields a
      `name-`-prefixed slug for the pipeline).
- [ ] After a pipeline intent stage lands, the seed file supplied via `--seed <path>` is deleted in
      the landing commit; a test pins its absence and fails against the pre-fix code.
- [ ] `--seed-text` still produces the inline-seed slug/name with `paths: []`, and no deletion is
      attempted; a regression covers it.
- [ ] `pipeline start --seed <path>` refuses at admission with a named error when the path is
      absent, is a directory, or escapes the registered project after symlink resolution — before
      any pipeline row is created.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — `--seed <path>` behaves like the standalone
  intent seed path, including seed consumption; `--seed-text` is inline-only.
- `v2/docs/workflow-runner.md` — the publication landing contract applies to pipeline-supplied
  seed paths too.

## Prerequisites

- `resolveIntentSeed` path vs text branches (`publication-workflow-steps.ts`)
- `resolvePipelineSeed` and `PipelineContext` construction (`v2/src/commands/pipeline.ts`)
- `resolveIntentStage` seed wiring (`v2/src/daemon/pipeline-stage-resolve.ts`)
