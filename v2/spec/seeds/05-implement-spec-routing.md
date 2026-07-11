# Implement spec-path resolution and index-linked subspec routing

Extend `implement` so operators pass `--spec <path>` and the harness routes each
write iteration to the active linked subspec — not a manual `--artifact` flag.

## Scope

- `buildImplementWorkflowSteps`: resolve project from spec path walk (registry),
  not cwd-only; derive branch from spec dir when `--branch` omitted (document
  rule).
- Port index routing: `getActiveLinkedSubspecPath` equivalent — inject active
  subspec body into implement prompt; `expectedArtifactPath` follows active
  subspec.
- Jarvis-owned `index.md` checkbox updates remain harness responsibility (agent
  ticks subspec AC only) — match v1 patch semantics where ported.
- Relax `implement` preset length validation: 1–2 steps when review is added
  later (seed 09); this seed may stay write-only.
- Tests: multi-subspec spec, routing advances as subspecs complete.

## Decisions

- Keep preset name `implement`.
- `--artifact` flag deprecated or ignored when `--spec` points at `index.md` —
  document breaking CLI change for v2 implement.

## Prerequisites

- Generic workflow launcher merged (seed 01).
- `implement` preset exists.

## Out of scope

- Post-completion review step (seed 09).
- Patch-tier, fix-up, stuck-red loopback.

## Reference

- `.scratch/v2-operator-workflows.md` — §`implement`, seed 05

## Documentation updates

- `v2/docs/write-behavior.md` — spec-path resolution, index routing
- `v2/docs/first-workflow-walkthrough.md` — drop manual `--artifact` when
  routing lands
