# Preserve the fence through review-mutation recovery

Review-mutation recovery is a separate production route and must not sweep a rejected repair into a
later completion commit.

## Decisions

- When review-mutation recovery resolves its completed write sibling, it must recover that run's
  persisted frozen allowset and rejection provenance before staging, publishing, or replaying the
  publication tail.
- A rejected out-of-scope path remains dirty and yields `completion_commit_failed`; it cannot be
  committed or published by this recovery route.

## Work

- Apply the durable ready-gate repair fence to review-mutation recovery independently of
  completed-run retry/resume.
- Add focused recovery regression coverage and record the v2 behavior in the parity catalog.

## Acceptance criteria

- [ ] A focused `v2/src/execution/workflow-runner.test.ts` review-mutation recovery regression
      proves a rejected path cannot be swept into a later commit or publish, while the preserved
      fence reports `completion_commit_failed`; it fails against the unfenced recovery baseline.
- [ ] The review-mutation regression turns red when its recovered-fence guard is inverted or
      bypassed.
- [ ] `v2/docs/write-behavior.md` documents review-mutation recovery's preserved-fence boundary,
      and `v2/docs/v1-behaviors.md` records the v2 behavior in the parity catalog.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/write-behavior.md` — review-mutation recovery fence.
- `v2/docs/v1-behaviors.md` — v2 parity-baseline entry for ready-gate repair fencing.
