---
name: workflow-review-options
---

# Configure optional review on every workflow preset

Let operators compose review onto `intent`, `plan`, and `implement` with `--review-passes <n>` and `--review-behavior debate|light`. Zero passes omit the review step. Retain the three primary preset names; legacy reviewed names may alias them with a terse migration hint instead of remaining implementation surfaces. Resolve implement launch inputs in its builder rather than `cli.ts`.

## Decisions

- Apply the same review flags to all three primary presets; rules out preset-specific option contracts.
- Omit review entirely for `--review-passes 0`; rules out a zero-cycle review step.
- Keep `intent`, `plan`, and `implement` CLI names; rules out breaking the primary operator commands.
- Permit legacy reviewed names only as aliases with migration guidance; rules out duplicate builders and silent incompatible removal.
- Resolve implement launch inputs in the builder; rules out workflow-specific launch policy in `cli.ts`.
- Keep `cli.ts` intact as a file; rules out a CLI file split during this change.

## Documentation updates

- `v2/docs/workflow-runner.md` — preset table, flags, aliases, and builder-owned launch resolution.
- `v2/docs/first-workflow-walkthrough.md` — canonical intent, plan, and implement commands.
- `v2/docs/v1-behaviors.md` — operator-visible workflow command behavior.

## Prerequisites

- Intent and plan publication are selected from one publication definition.
- Light and debate review share one runner dispatch and prompt-profile contract.
