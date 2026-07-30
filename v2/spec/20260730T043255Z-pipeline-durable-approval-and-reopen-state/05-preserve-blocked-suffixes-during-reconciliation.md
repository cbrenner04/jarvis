# Preserve blocked suffixes during reconciliation

## Problem

- Restart reconciliation can rewrite a failed pipeline's `skipped` suffix as `interrupted`, erasing the durable
  continuation shape.

## Decisions

- Treat `skipped` rows as reconciliation-stable, as with approval rows; rules out losing the suffix blocked by a
  failure before reopen.

## Task checklist

- Preserve skipped stage rows during reconciliation.
- Add focused reconciliation coverage.
- Update reconciliation docs.

## Acceptance criteria

- [ ] Restart reconciliation leaves a failed stage and its following skipped rows unchanged, including each durable
      row ID, authored `stageId`, and blocked-suffix status.
- [ ] A new or updated `v2/src/persistence/state-store.test.ts` regression for skipped-suffix reconciliation fails
      against the pre-fix store behavior.
- [ ] Inverting the skipped-stability guard makes its targeted regression fail; the negative case proves no
      interrupted rewrite is persisted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` document skipped-suffix
      reconciliation behavior.

## Documentation updates

- `v2/docs/state-store.md` — reconciliation-stable blocked suffixes.
- `v2/docs/daemon-host.md` — restart treatment of blocked suffixes.
- `v2/docs/v1-behaviors.md` — additive v2 blocked-suffix reconciliation.
