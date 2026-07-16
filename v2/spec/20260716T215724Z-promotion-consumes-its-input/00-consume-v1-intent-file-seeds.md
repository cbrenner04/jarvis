# 00 - Consume v1 intent file seeds

V1 intent promotion leaves a successfully split file seed in `seeds/`, so the
queue continues to advertise completed intake. Inline seeds have no artifact to
consume.

## Decisions

- Add the safe source-to-publication-workspace deletion primitive with this first consumer; rules out an unconsumed helper designed ahead of a caller.
- Resolve and compare canonical source-root, source-file, publication-root, and mapped-target paths before deletion; rules out lexical containment that permits symlink escape.
- Skip missing, external, or symlink-escaped inputs without failing successful output publication; rules out turning a stale queue entry into a publication failure.
- In Git mode, map every file seed read into the intent worktree and delete it before the split commit; rules out mutating the operator checkout or leaving deletion outside the artifact commit.
- In no-commit mode, delete every file seed read only after all authored intents land; rules out early deletion that strands a retry after partial publication.
- Keep inline intent input out of consumption metadata; rules out deriving a filesystem target from display text.

## Acceptance criteria

- [ ] `v1/test/intent-command.test.ts` adds a Git-backed file-seed regression that fails against the baseline and proves one split commit contains every emitted ready-intent plus deletion of the consumed seed while unrelated seeds remain.
- [ ] `v1/test/intent-command.test.ts` adds no-commit regressions that fail against the baseline and prove a multi-output split consumes its file seed only after every ready-intent lands, while collision, validation, and publication failures leave it intact.
- [ ] `shared/publication-input-consumption.test.ts` covers multiple input paths and proves missing, external, and symlink-escaped mapped targets are skipped while safe targets are deleted; the target repo and publication workspace are compared by real path.
- [ ] Inline v1 intent runs create the same outputs without attempting source deletion.
- [ ] `v1/test/intent-command.test.ts` existing split, collision, validation, and inline-seed tests stay green.

## Documentation updates

- `v1/docs/spec-guidance.md` — define `seeds/` and `ready-intents/` as open-work queues and state the successful-promotion consumption boundary.
- `v1/docs/intent-mode.md` — replace retained-seed semantics with Git and no-commit success/failure behavior.
- `v2/docs/v1-behaviors.md` — update the v1 intent parity record and sources.
