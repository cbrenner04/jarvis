# 02 - Consume v2 intent file seeds

V2 intent landing publishes ready-intents without consuming file seeds. The
workflow snapshot retains seed content but not the source artifacts needed at
the deferred publication boundary.

## Decisions

- Carry the exact file inputs read by the intent builder into publication landing metadata; rules out reconstructing inputs from slug, output names, or the first positional path.
- Introduce consumption at the common publication landing boundary with intent as its first v2 consumer; rules out a preset-specific post-publication cleanup or an unconsumed abstraction.
- Make durable ready-intent landing precede source consumption for Git and no-Git workflows; rules out deleting an input before every output is present.
- In Git mode, delete mapped inputs inside the publication worktree so completion commit records output and consumption together; rules out direct deletion from the registered checkout.
- In no-Git mode, consume canonical in-scope source files only after transactional output landing succeeds; rules out retaining completed queue work merely because no commit exists.
- Preserve input metadata across review-last landing and publication resume; rules out re-reading or forgetting sources when landing is deferred or retried.
- Keep inline intent input out of consumption metadata; rules out deriving a filesystem target from display text.

## Acceptance criteria

- [x] `v2/src/execution/publication-landing.test.ts` adds a multi-output file-seed regression that fails against the baseline and proves all durable ready-intents land before every recorded safe input is consumed.
- [x] `v2/src/execution/workflow-runner.test.ts` proves Git-backed intent deletion joins the ready-intent completion commit, no-Git success consumes the source, and inline seeds carry no deletion target.
- [x] `v2/src/execution/workflow-runner.test.ts` proves failed validation, landing, commit, push, or PR publication leaves the registered queue artifact intact for retry.
- [x] `v2/src/execution/publication-landing.test.ts` proves batched input metadata consumes every safe mapped input, skips missing, external, and symlink-escaped targets, and remains idempotent across deferred review landing and publication resume.
- [x] `v2/src/execution/intent-output.test.ts`, `v2/src/execution/intent-workflow-steps.test.ts`, and `v2/src/execution/workflow-runner.test.ts` existing intent landing, builder, review, and publication tests stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — define publication input metadata, landing/consumption ordering, Git commit boundary, no-Git boundary, and retry behavior.
- `v2/docs/first-workflow-walkthrough.md` — replace retained-seed semantics with successful file-promotion consumption and failure retention; inline seeds remain artifact-free.
