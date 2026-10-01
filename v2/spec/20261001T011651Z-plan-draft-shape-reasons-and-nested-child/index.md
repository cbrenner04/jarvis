# Plan-draft shape failures name their cause and accept a timestamp-named nested dir

- [x] [00 - Suffixed plan.draft.shape reasons and compose fallback](./00-suffixed-shape-reasons-and-compose-fallback.md)
- [x] [01 - Accept single immediate-child staging directory](./01-accept-immediate-child-staging-dir.md)
- [x] [02 - Record shape reasons and nested-child acceptance in v1-behaviors](./02-record-shape-reasons-in-v1-behaviors.md)

Land **00 → 01 → 02** when batched: docs align with landed validation behavior. Harness gates (`typecheck`, `test:v2`, `test:integration:v2`) land with subspec 02.
