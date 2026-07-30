- Require the stub to classify each fixture from the rendered, delimited seed content—not its filename—and reject missing or altered content. This proves the production builder/write seam carries committed seed semantics.

- Require the single-surface intent’s rationale to contain a non-empty explanation on exactly one physical line. A bare `Unsplit rationale:` does not satisfy the acceptance criterion.

- Require the single-surface intent’s sole primary owner to be the expected execution-loop boundary, not merely any single owner.

- Require multi-surface output to encode the documented dependency chain: daemon depends on persistence; CLI depends on persistence and daemon. This enforces `v2/docs/workflow-runner.md`’s prerequisite contract, which an unordered owner-set assertion does not cover.
