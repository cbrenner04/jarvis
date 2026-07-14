# Surface a named routing-read error

Linked implement routing reads its index before creating the first run row. A
filesystem rejection currently reaches the daemon's generic pre-row catch and
is mislabeled `invalid_params`, obscuring the failing path and state problem.

## Decisions

- Throw `LinkedIndexReadError` at the linked-index read with the resolved index path and original failure reason; rules out raw filesystem errors escaping `runLinkedImplementStep`.
- Map only `LinkedIndexReadError` to daemon code `routing_read_failed`; rules out message or `ENOENT` sniffing and preserves `invalid_params` for every other pre-row rejection.
- Cover the pre-first-row failure only; rules out changing post-row harness-failure settlement or fixing worktree/spec-path resolution here.

## Work

- Add the typed linked-index read failure and preserve its path and cause in the operator message.
- Propagate its dedicated daemon error code without changing the generic catch-all's other callers.
- Add focused workflow-runner and daemon regression coverage.
- Align durable operator and daemon contracts.

## Acceptance criteria

- [ ] A linked implement workflow whose routing index cannot be read returns `routing_read_failed`, not `invalid_params`, and names the resolved index path and underlying read reason.
- [ ] New cases in `v2/src/execution/workflow-runner.test.ts` and `v2/src/daemon/daemon-workflow-start.test.ts` assert the typed source error and daemon response; they fail against the pre-fix code and pass after the change.
- [ ] Existing non-routing pre-row rejection coverage in `v2/src/daemon/daemon-workflow-async-failure.test.ts` stays green with `invalid_params`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/operator-runbook.md` with the `routing_read_failed` meaning and failing-path diagnostic.
- Update `v2/docs/daemon-host.md` with the typed pre-row routing failure alongside the unchanged catch-all behavior.
- Update `v2/docs/v1-behaviors.md` to replace the blanket pre-row `invalid_params` statement with the routing-read exception.
