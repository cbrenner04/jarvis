# Reconcile route-by-target conventions

## Problem

`CLAUDE.md` § "Specs in this repo" and `spec-guidance.md` describe a muddled layout: v2 work-seed intents under `v2/spec/wip-intents/` while specs route to `v1/spec`, and neither states which tree net-new artifacts go to. The operator's decided shape is route-by-target: v1 work (seeds + committed specs) under `v1/spec/`, genuine v2 planning under `v2/spec/`, both-surfaces → v1 wins. Align the conventions so authoring lands in the correct home from the start.

## Decisions

- Default is v1 (the shipping surface); v2 planning is the explicit exception authored with `--target-dir v2/spec` (on both `jarvis intent` and `jarvis plan`). — rules out documenting v2/spec as default and forcing v1 work to carry a flag.
- Document the convention only; the live `~/.jarvis/config.json` default flip is operator action, not a repo change. — rules out an AC asserting machine-local config the repo can't verify.
- The live `plan.targetDir` is `v2/spec` today, so the rewritten docs must read as honest about the gap: state that the route-by-target default is realized only once the operator flips the live config, and sequence that flip to immediately follow merge so the merged docs do not assert config that is not yet true. — rules out merging aspirational wording that reads as current fact during the divergence window.

## Task checklist

- [ ] Rewrite `CLAUDE.md` § "Specs in this repo" to state route-by-target.
- [ ] Update `spec-guidance.md` location/authoring sections to match and note intent's `--target-dir`.

## Acceptance criteria

- [ ] `CLAUDE.md` § "Specs in this repo" states the route-by-target rule: v1 work (seeds and committed specs) lives under `v1/spec/`, genuine v2 planning under `v2/spec/`, and a spec touching both v1 and v2 surfaces routes to `v1/spec` (shipping surface wins); the prior wording placing work-seed intents under `v2/spec/wip-intents/` while specs route to `v1/spec` is removed.
- [ ] `CLAUDE.md` states the jarvis project default `plan.targetDir` is `v1/spec` and that v2 planning is authored with an explicit `--target-dir v2/spec` override, and notes the route-by-target default takes effect only after the operator flips the live `~/.jarvis/config.json` from `v2/spec` to `v1/spec` (so the merged doc does not read as already-true config).
- [ ] `v1/docs/spec-guidance.md` location-conventions/authoring section documents that `jarvis1 intent` accepts `--target-dir` (parity with `jarvis1 plan`) and states the same route-by-target rule.

## Documentation updates

- [ ] This subspec is the documentation work (`CLAUDE.md`, `v1/docs/spec-guidance.md`); no separate doc set.
