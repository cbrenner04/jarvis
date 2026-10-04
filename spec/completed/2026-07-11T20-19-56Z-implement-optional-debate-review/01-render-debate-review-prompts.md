# Render debate review prompts

This spec is the first production consumer to construct a `review-debate` step, so
the path from `patch.prompt.review.*` templates to the per-cycle, role-chained
prompt strings the review executor runs must be defined as an observable contract.

## Decisions

- Render the debate roles from the existing `patch.prompt.review.*` templates; rules out a parallel implement debate prompt family.
- Inject the executed spec tree, branch diff, and pass number into each role render; rules out running roles on static templates without run context.
- Chain roles within a cycle by feeding each role's output into the next role's render, and carry that output into the next cycle; rules out isolated per-role renders that lose the debate across roles and cycles.

## Tasks

- [x] Bind the debate roles to the existing patch review prompt IDs (`patch.prompt.review.*`).
- [x] Render each role prompt with the injected spec tree, branch diff, pass number, and prior-role output.
- [x] Feed each role's output into the next role's prompt within a cycle, and the cycle's output into the following cycle, up to the bounded cycle count.
- [x] Cover role binding, per-cycle context injection, and prior-role/cycle output chaining.

## Documentation updates

- [x] Update `v2/docs/workflow-runner.md` with the review-debate prompt rendering and role/cycle chaining dataflow.

## Acceptance criteria

- [x] The implement review step's role prompts derive from the existing `patch.prompt.review.*` adversary, advocate, adjudicator, and actuator templates.
- [x] Each cycle renders those roles with the executed spec tree, branch diff, and pass number injected.
- [x] Each role's output feeds the next role's render, and each cycle's output carries into the following cycle, up to the bounded cycle count.
- [x] `v2/src/execution/review-debate-render.test.ts` covers role binding, context injection, and role/cycle chaining.
