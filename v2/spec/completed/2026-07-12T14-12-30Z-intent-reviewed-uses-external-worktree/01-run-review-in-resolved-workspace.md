# Run review in the resolved workspace

Execute reviewed-intent review exclusively in its split workspace.

## Decisions

- Run every applicable review, enforcement, and verdict operation in the resolved split workspace — rules out merely keeping the operator checkout clean while some operations use it.

## Tasks

- Run critic, actuator, verdict handling, and boundary restoration in the derived workspace.
- Add focused runner coverage.

## Acceptance criteria

- [x] Critic, actuator, boundary enforcement, and verdict handling for a reviewed intent use the resolved split workspace.
- [x] A reviewed-intent run leaves unrelated dirty files in the operator checkout unchanged while those operations run in the split workspace.
- [x] `v2/docs/first-workflow-walkthrough.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` document the reviewed-intent review workspace.

## Documentation updates

- Update `v2/docs/first-workflow-walkthrough.md`.
- Update `v2/docs/workflow-runner.md`.
- Update `v2/docs/v1-behaviors.md`.
