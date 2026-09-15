# Project specs config key

`projects.<key>.specs: "external" | "repo"` replaces `git`/`plan.commit`/`modes.plan.commit` as the spec-home knob; legacy keys fail validation naming `specs`. Default flips from `"repo"` (preserved by 00) to `"external"` once 01 wires every site.

- [x] [00 — resolver, rejection, intent/plan wiring, docs](00-specs-key-resolver-intent-plan.md)
- [x] [01 — pipeline chained stages, implement admission, default flip](01-specs-key-pipeline-implement.md)
