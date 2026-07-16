---
name: ready-gate-tier-is-not-configurable
---

# The v2 ready gate hardcodes the full tier and stomps the operator's environment

Every v2 run's publication tail runs the full aggregate test suite. It takes 8–15 minutes, it runs
on every plan and every implement, and there is no way to lower it — `ready-finalize.ts:54`
overwrites `JARVIS_READY_TIER` in the child environment, so setting it locally does nothing.

## Problem

```ts
// v2/src/execution/ready-finalize.ts:54
env: { ...process.env, JARVIS_READY_TIER: "full" },
```

The spread is followed by the literal, so the operator's value is not merely ignored — it is
overwritten. `export JARVIS_READY_TIER=…` has no effect on a v2 run, and nothing says so.

Observed 2026-07-16: a plan spec whose write loop took ~2 minutes spent ~13 more in the gate. Wall
clock for a two-file markdown spec was ~15 minutes, ~85% of it gate. The tail is the dominant cost
of every v2 workflow, and it is paid identically by a two-file plan PR and a full implement run.

The full tier is right for CI and right before a merge. It is not obviously right for a plan
workflow that only writes markdown into `v2/spec/`, where the aggregate suite cannot regress
anything the diff touches.

Compounding: the aggregate suite is the one suite CI never runs (`ci-cannot-protect-the-local-ready-gate`),
so this is also the slowest and least-protected path in the system.

## Decisions

- **Tier is resolved from config, defaulting to `full`.** The safe default stays; the operator gets
  a lever. Rules out today's unconditional literal, which is a policy baked into a call site.
- An explicitly-set `JARVIS_READY_TIER` is honored rather than silently overwritten. If the harness
  intends to ignore it, it says so instead of pretending to merge the environment. Rules out the
  current `{...process.env, JARVIS_READY_TIER: "full"}` shape, which reads as "inherit" and behaves
  as "override".
- Tier may be derived from what the run actually changed — a markdown-only plan tree does not need
  the v1 patch suite. Rules out charging every workflow the worst-case gate. Reuses the existing
  path-scoping logic (`scripts/ci-test-scope.ts`) rather than inventing a second scoping rule.
- The merge-gating path keeps `full` regardless of the lever. Rules out a config knob that can
  quietly weaken what `triage --merge` enforces.

## Prerequisites

- None.

## Out of scope

- Making the aggregate suite itself faster, or splitting its slowest file
  (`ci-cannot-protect-the-local-ready-gate`).
- Whether CI should run the aggregate at all.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — currently states the gate "runs the `full` tier
  unconditionally, overriding any `JARVIS_READY_TIER` in the parent environment"; document the
  config lever and what still forces `full`.
- `v2/docs/install-and-config.md` — the new config key.
