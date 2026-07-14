# v2 workflows write every artifact to the configured targetDir, ignoring the seed's surface

`jarvis run workflow intent --seed v1/spec/seeds/<x>.md` writes its ready-intents to
**`v2/spec/ready-intents/`**. So does `plan`, for its spec tree. The output dir comes from
`~/.jarvis/config.json` `plan.targetDir` alone; the seed's own location is ignored, and v2 has no
`--target-dir` flag (`grep -rn "target-dir" v2/src` → no hits; v1's `plan`/`intent` both have one).

## Problem

Observed 2026-07-14, twelve `intent-reviewed` runs. Six were driven from **v1** seeds
(`v1/spec/seeds/blocked-run-records-no-cost.md`, `…/quota-patterns-…`,
`…/idle-output-timeout-…`, `…/local-gate-green-while-ci-red.md`,
`…/tests-hermetic-machine-config.md`, `…/acceptance-criteria-do-not-require-a-failing-test.md`).
Every one of them landed its ready-intent under `v2/spec/ready-intents/` (#1518–#1528). The
`plan` run for the v1 ready-intent `zero-output-iteration-is-a-harness-defect` likewise cut its
spec tree at `v2/spec/20260714T022528Z-…/`, for a change to `v1/src` patch mode.

`AGENTS.md` § Specs in this repo is explicit: "v1 work (seeds and committed specs) lives under
`v1/spec/`; genuine v2 planning under `v2/spec/`… a spec touching both surfaces routes to
`v1/spec`." The harness cannot honor that rule today — the operator's only lever is to hand-edit
the config between runs, which is not usable when v1 and v2 seeds are driven in the same session.

Compounding: `lint:md` globs `v1/spec/**`, `v1/docs/**`, `reports/**`, `v2/docs/onboarding.md`,
`README.md`, `AGENTS.md` — **not `v2/spec/**`**. So misrouted specs are also unlinted.

## Decisions

- **A workflow's output surface is derived from its input, not from a global default.** A seed or
  ready-intent under `v1/spec/` produces artifacts under `v1/spec/`. Rules out "the operator flips
  `plan.targetDir` between runs".
- An explicit override (`--target-dir`) may exist, but it is not the fix — the default must be
  right without it.
- Do not fix by changing the live config's `plan.targetDir`; that just inverts which surface is
  broken.

## Prerequisites

- None.

## Out of scope

- Relocating the ~10 ready-intents and one spec tree already misrouted this session (operator
  cleanup, tracked separately).
- Whether `lint:md` should cover `v2/spec/**`.

## Documentation updates

- `v2/docs/workflow-runner.md` — where each preset writes, and how the surface is resolved.
