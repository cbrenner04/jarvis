# Publish the spec template for implement workflows

## Problem

- Daemon-backed implement completion omits the deterministic spec summary used by plan and direct implement publication.

## Decisions

- Derive workflow implement summaries with `deriveSpecRunBodySummary`; rules out an implement-only renderer.
- Mark implement publication for retry-time spec-template derivation; rules out freezing the first derived summary across publication retries.
- Preserve intent and plan selection plus summary/narrative/attribution precedence; rules out changing other publication kinds or marker behavior.
- Cover the workflow seam with a spec-backed source-only Git fixture in `v2/src/execution/workflow-runner.test.ts`; rules out renderer-only regression coverage.
- Deferred to first consumer: unifying v1 and v2 PR rendering in `shared/` — pin when a caller needs it.

## Work

- [ ] Select the deterministic spec template for implement workflow completion.
- [ ] Replace the implement no-summary expectation with publication regression coverage for spec, commit, risk, and diff context.
- [ ] Align `v2/docs/workflow-runner.md` and `v2/docs/v1-behaviors.md` with implement body composition and its source seam.

## Acceptance criteria

- [ ] Implement workflow completion supplies a deterministic template containing `## Subspecs`, `## Commits`, `## Risk cues` with `no test changes` for a source-only diff, and `## Change summary` derived from its spec tree and `baseRef...HEAD` branch diff.
- [ ] The implement template is re-derived on publication retry and renders before any preserved narrative marker block and regenerated attribution footer.
- [ ] The implement publication regression in `v2/src/execution/workflow-runner.test.ts` fails against the baseline and passes after the change.
- [ ] Existing plan and intent body-summary cases in `v2/src/execution/workflow-runner.test.ts` stay green.
- [ ] `v2/docs/workflow-runner.md` documents implement template composition; `v2/docs/v1-behaviors.md` records the workflow runner as the v2 implement template source.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement PR body composition and ordering.
- `v2/docs/v1-behaviors.md` — workflow implement template source record.
