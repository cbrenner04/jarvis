---
name: agent-confinement-is-per-vendor-and-unexpressed
---

# Each agent adapter hardcodes a different confinement model, and Jarvis expresses none of them

## Problem

The same spec runs under materially different confinement depending on which `agents` rung answered, and nothing in the harness says which. Every adapter hardcodes one vendor-shaped flag set in `shared/invocation/agents.ts`:

| Agent | What Jarvis passes | What that means |
| --- | --- | --- |
| codex | `--sandbox workspace-write`, `-c approval_policy="on-request"` (`:746-748`) | explicit filesystem confinement, configurable via `codexSandboxMode` |
| claude | `--permission-mode acceptEdits`, plus `appendAdditionalReadDirFlags` (`:686-687`) | a permission model with read-dir scoping; no filesystem sandbox |
| cursor | `--force`, `--workspace <cwd>` (`:978-980`) | approvals bypassed; cursor applies its own internal sandbox, which Jarvis neither selects nor observes |

`codexSandboxMode` is the only knob, and it reaches exactly one adapter. There is no per-project control, no way to state a confinement requirement for a project, and no record on the run row or in telemetry of which confinement a given invocation actually ran under. Quota fallback moves work between rungs silently, so a spec can start under codex's `workspace-write` and finish under cursor's `--force` with no operator-visible transition.

The consequence is not "agents are unconfined" — each vendor confines in its own way. It is that **confinement is an emergent property of which rung answered**, which is exactly the property an operator cannot reason about.

## History

Filed as #1453, which proposed a full sandbox-policy architecture. The owner's comment: *"written with no familiarity with the harness so make to confirm assumptions prior to creating a seed."* A scoped-down seed (`agent-execution-policy-is-per-vendor-and-inconsistent`, #1454) was cut on 2026-07-12 after checking the body's assumptions against the code, then removed unimplemented by #1762 ("purge stale backlog to the critical set"). Re-seeded 2026-09-07, re-verified against `main`, and narrowed further than the 2026-07-21 triage — that triage recorded "only codex is sandboxed; claude, cursor and opencode run with no confinement flags", which understates cursor's own sandbox and claude's permission mode.

Priority is P3: single-operator repo, agents run against the operator's own worktrees. The cost is legibility, not exposure.

## Decisions

- Confinement is expressed once as a harness-level intent (a small named policy, not vendor flags), and each adapter translates it into its vendor's mechanism; rules out per-adapter hardcoded flag sets as the only expression of policy.
- An adapter that cannot honor the requested policy refuses the binding rather than silently running under a weaker one; rules out quota fallback quietly changing confinement mid-spec.
- The resolved policy and the vendor mechanism it translated to are recorded per invocation in telemetry alongside `agent`/`model`; rules out confinement being unobservable after the fact.
- Policy resolves per project with a machine-level default (same cascade shape as [[per-project-config-overrides-seam]]); rules out a machine-wide-only knob repeating the `agentOrder` mistake.
- Defaults preserve today's behavior exactly for every adapter; rules out a policy layer that changes what runs today as a side effect of becoming expressible.

## Acceptance criteria

- [ ] A test proves each adapter's argv under the default policy is byte-identical to today's, per agent; it fails against any change in default invocation.
- [ ] A test proves a project requesting a confinement its resolved binding cannot honor refuses that binding with a named reason instead of invoking it; it fails against the current unconditional invoke.
- [ ] A test proves each invocation records its resolved policy and the vendor mechanism applied in the telemetry row; it fails while telemetry carries no confinement field.
- [ ] A test proves project-level policy overrides the machine default and that an unset project inherits it.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — the policy, its cascade, and the per-vendor translation table.
- `v2/docs/install-and-config.md` — project and machine keys.
- `v2/docs/operator-runbook.md` — reading confinement from telemetry.
- `v2/docs/v1-behaviors.md` — record the policy layer and unchanged defaults.
