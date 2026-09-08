---
name: render-operator-failures-consistently
---

# Render operator failures consistently

## Prerequisites

- Durable run rows and terminal pipeline-stage `failureDetail` round-trip one shared operator failure record with expectation, observation, optional near miss, reissue retryability, and path origin.
- Intent, plan, and implement settlement producers populate that record with checkable evidence, authored-document near misses, honest reissue semantics, and resolved path origins.
- Daemon run and pipeline observations expose the durable record unchanged, with resume admission, `resumable`, and `nextAction` derived from its retryability.

## Module-boundary surface

- CLI: shared operator presentation used by run commands, pipeline commands, and the TUI host.

## Problem

Run, pipeline, and TUI surfaces expose different subsets and shapes of failure detail, forcing operators to infer missing evidence or read harness source.

## Behavior

- One formatter renders an identical failure block for a record in `run list`, `run wait`, `pipeline list`, and TUI detail while preserving structured data for machine-readable output.

## Decision ledger

- Make one formatter the sole owner of human-readable failure text across command and TUI hosts; rules out per-surface prose that drifts.
- Render labeled expectation, observation, optional near miss, and whether reissue can help; rules out a bare conclusion or unexplained retry flag.
- Label every referenced path as harness-internal or operator-repository from recorded origin; rules out path-prefix heuristics and ambiguous ownership.
- Preserve each command's surrounding identity, lifecycle, and exit-code contract; rules out using failure consistency to redesign unrelated output.
- Define cross-surface identity as the formatted failure block only; rules out treating each surface's necessary surrounding output as formatter drift.
- Keep the structured record in machine-readable output alongside its formatted presentation; rules out forcing scripts to parse prose.

## Acceptance criteria

- [ ] One cross-surface regression passes the same record through `run list`, `run wait`, `pipeline list`, and TUI detail and asserts their formatted failure blocks are identical while allowing their surrounding output to differ; it fails if any pre-fix surface constructs or omits its own failure text.
- [ ] Formatter tests prove no-candidate and unmatched-near-miss records render distinct observations and only the latter includes the candidate.
- [ ] Formatter tests prove harness-internal and operator-repository paths receive distinct labels.
- [ ] Existing `v2/src/commands/run.test.ts` wait exit-code and list identity-column tests stay green, and existing pipeline/TUI lifecycle presentation tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — short “reading a contract failure” section covering expectation, observation, near miss, path origin, and whether reissue can help.
- `v2/docs/write-behavior.md` — run/pipeline command output uses the shared formatter and retains structured failure data.
- `v2/docs/tui.md` — TUI failure detail uses the same formatter; cross-link the operator runbook for field meaning.
- `v2/docs/v1-behaviors.md` — record the v2 cross-surface rendering behavior.
