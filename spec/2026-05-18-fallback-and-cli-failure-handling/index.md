# Fallback logic and CLI failure handling

repo: https://github.com/cbrenner04/jarvis.git

Unify how Jarvis classifies agent CLI failures (stderr/exit codes), how **strict** vs **lenient** quota interacts with **fallback** (patch iteration vs plan-phase agent loops), and what operators see in logs and telemetry. Builds on the shared **`applyQuotaFallbackWhenAllowed`** / porcelain guard work already merged.

## Subspecs

- [ ] [00 — Outcome matrix and operator-facing docs](./00-outcome-matrix-and-docs.md)
- [ ] [01 — Harness messages and telemetry alignment](./01-harness-messages-and-telemetry.md)
- [ ] [02 — CLI classification pipeline (spawn + post-process)](./02-cli-classification-pipeline.md)
- [ ] [03 — Multi-agent hard-error semantics (plan vs patch)](./03-multi-agent-hard-error-semantics.md)

## Conventions

- Land this tree on `main` (**spec-only PR**) before running `jarvis run spec/2026-05-18-fallback-and-cli-failure-handling/index.md`.
- Complete **one subspec per iteration** unless a subspec explicitly allows bundling.
- If blocked, append `## Blocker` to that subspec and stop.
