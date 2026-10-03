# 00 — Admit `--risk` and `--effort` at pipeline start

## Problem

`jarvis pipeline start` reads seed frontmatter ratings only; operators cannot override per launch, and admission does not record how each effective rating was chosen.

## Decisions

- Add optional `--risk` and `--effort` to `jarvis pipeline start`; each flag overrides that dimension's seed frontmatter independently; an omitted flag keeps the seed value for that dimension — rules out paired-only overrides or a single combined rating flag.
- Inline `--seed-text` and file `--seed` share one path: parse frontmatter from the admitted seed bytes, then merge flags — rules out a second parser for file seeds; name-less rating selection still requires each dimension from seed or flags (`unresolved-rating` when missing), while explicit `pipeline.name` admits without ratings — rules out requiring frontmatter ratings when name wins.
- When seed, flags, and project minimums together leave a dimension without a supplied rating, refuse pre-admission with the existing `unresolved-rating` resolution error (reachable today for unrated prose seeds against name-less configs in `pipeline-start-admission.test.ts`); project `minimumRisk`/`minimumEffort` remain floors only — rules out requiring both flags on every start, silent defaults, or promoting a minimum to a default rating.
- Malformed seed frontmatter ratings keep today's `pre-admission-failure` `invalid-seed-rating` detail (`pipeline: seed frontmatter \`dimension:\` must be one of…`, reachable in`pipeline-start-admission.test.ts`); malformed`--risk`/`--effort` values refuse before daemon connect via shared `parseRatingLevel`, mapped to`pre-admission-failure``invalid-project-pipeline` with `detail` matching `formatProjectPipelineResolutionError` for `invalid-rating`(`invalid-rating: …` naming the dimension) — rules out daemon-side flag validation, `invalid-seed-rating` for flags, or ad-hoc flag-only error strings.
- Per dimension after merge: `supplied` is flag value when the flag was present else seed value; `effective = max(project minimum, supplied)`; `source` is `minimum` when the floor strictly raised `supplied`, else `flag` when the flag was present, else `seed` — rules out one global source label or attributing a floor raise to seed/flag.
- When `projects.<key>.pipeline.name` is set, rating flags are ignored for selection (name wins outright) and admission carries no rating metadata — rules out rejecting flags beside an explicit name or persisting bogus rating rows for name-selected pipelines.
- Merge seed and flags into `SuppliedRatings`, then select only through `resolveProjectPipeline` (extend its success result with effective ratings and per-dimension sources used at admission) — rules out duplicate floor math in the CLI or agent interpretation of seed prose at launch.
- Deferred to first consumer: `--risk`/`--effort` on TUI detached `pipeline start` — pin when dock grammar exposes the same flags.

## Task checklist

- Extend `PIPELINE_START_PARSE_ARG_OPTIONS`, help flags, and `parsePipelineStartArgs` / usage strings for `--risk` and `--effort`.
- Extend `PipelineStartAdmissionInput` (or parallel admission options) with optional flag ratings; merge in `admitPipelineStart` before `resolveProjectPipeline`.
- Extend `resolveProjectPipeline` success payload with admission rating metadata (effective levels and sources) without changing refusal codes for invalid/unresolved ratings.
- Add `pipeline-start-admission.test.ts` coverage for seed-only, each flag alone (other dimension from seed), both flags, floor below/above project minimum, malformed flag values, missing ratings, and distinct `(risk, effort)` pairs mapping to admit vs refuse; add `@mutate` checkpoints on merge and ignore-name guards where applicable.

## Acceptance criteria

- [ ] `pipeline-start-admission.test.ts` adds flag parsing and merge cases (each flag alone with the other dimension from seed, both flags, overrides below and above the project floor, malformed flag values) and asserts per-dimension effective ratings and `source` (`seed` | `flag` | `minimum`, including floor raises); fails against the pre-fix CLI (unknown `--risk`/`--effort`, no merge, or missing resolution metadata).
- [ ] `pipeline-start-admission.test.ts` covers seed-only admission, missing ratings (`unresolved-rating`), and distinct `(risk, effort)` pairs that admit or refuse per `RATING_PAIR_PIPELINES` (extends existing green paths; not required to fail on baseline).
- [ ] `project-pipeline-resolution.test.ts` stays green for existing name precedence, minimum floors, and pair mapping (`rating selection` describe).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [03 — Operator and spec documentation](./03-operator-and-spec-docs.md).
