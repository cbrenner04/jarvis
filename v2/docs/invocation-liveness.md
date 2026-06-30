# Invocation liveness

Canonical behavioral contract for distinguishing **stall** (process up, no useful
progress toward the step outcome) from **slow work** (long but legitimate) during a
single agent invocation. Enforcement — signal algorithms, timeout tables, kill paths,
config knobs, and operator-visible stall diagnostics at termination — is owned by
the shared invocation layer when it lands; this doc pins policy only.

Related: [`shared-invocation.md`](./shared-invocation.md) (binding fallback seam),
[`role-resolution.md`](./role-resolution.md) (behavior × role taxonomy),
[`v1-behaviors.md`](./v1-behaviors.md) (v1 contrast).

## Terminology

| Term | Meaning |
| --- | --- |
| **Invocation liveness** | Whether a single step invocation is making outcome-relevant progress. Evaluated by shared invocation; consumed by workflow loops. |
| **Run orchestration liveness** | Whether a run's loop Promise is still executing (`isLive` on daemon `list` responses). A run can be orchestration-live while an invocation is stalled, and orchestration-not-live after a committed boundary even though the operator may start a fresh invocation on resume. See [`daemon-host.md`](./daemon-host.md). |

Do not conflate the two: `isLive` answers "is the runner still in flight?";
invocation liveness answers "is this agent invocation still earning its time budget?".

## Definitions

**Slow work** — the agent process is running and at least one progress signal
(see below) indicates movement toward the step's declared outcome within the
invocation's liveness profile. Duration alone does not make work slow; absence of
outcome-relevant progress does.

Positive examples:

- **`actuator` applying a verdict** — edits land on files the verdict targets;
  commits or workspace movement toward the applied outcome even when stdout is sparse.
- **`implement` under `write`** — touches acceptance-criteria files, runs targeted
  tests, or advances the artifact the step owns; long silent stretches during compile
  or test runs still count when workspace activity or completion markers move.
- **Read-only debate roles** (`adversary`, `advocate`, `adjudicator`) — produce
  review artifacts (findings, rebuttal, verdict text) even when no repo files change.

**Stall** — the agent process is still up (or the harness has not yet classified
termination) but no progress signal has moved toward the step outcome for longer than
the profile's stall-detection budget allows.

Negative stall candidate — process up, no agent output, no outcome-relevant workspace
movement, and no step-completion marker advance for the full stall window. A hung
tool call with zero file activity and zero streamed output is a stall; a long test
run that periodically updates workspace mtimes or emits markers is not.

These definitions are intentionally non-circular: **slow work** is characterized by
positive progress signals; **stall** is the sustained absence of all of them past a
profile-bound threshold.

## Progress signal categories

Liveness evaluation is multi-category and outcome-oriented. A profile may weight
categories differently; weights, sampling intervals, and numeric thresholds are
deferred to the first enforcement consumer in shared invocation.

| Category | Behavioral meaning |
| --- | --- |
| **Agent output** | Stdout/stderr (or adapter-equivalent streamed text) from the running agent. |
| **Workspace activity toward step outcome** | File-system changes in the invocation cwd that plausibly advance the step's outcome (edits, test artifacts, review doc writes). Activity unrelated to the step outcome does not count. |
| **Step-completion markers** | Harness-observable signals that the step contract is advancing (e.g. outcome token emitted, contract check passed, role-specific artifact produced). |

v1's effective signal is roughly `max(output idle, file idle)` under one global
`idleOutputTimeoutMs` plus a parallel `iterationTimeoutMs` wall — see
[`v1-behaviors.md`](./v1-behaviors.md). v2's contract is not "global output-idle
timer only."

## Stall-response categories

When stall is detected, the response category is recorded at policy level. Kill-path
wiring (signals, process-group teardown, telemetry field names) is deferred to
enforcement.

| Category | Meaning |
| --- | --- |
| **Terminal abort after bounded stall** | No further binding rungs and no profile allowance for continuation — invocation ends as a stall failure distinct from quota. |
| **Binding advance when later rungs remain** | Stall on the current `(agent, model)` rung advances the quota-only fallback chain to the next binding; stall is not quota exhaustion. |
| **Role-dependent mix** | Some roles terminate on stall without advance (e.g. read-only debate roles where retry semantics differ); writers (`implement`, `actuator`) may advance when rungs remain. Exact mix per profile is pinned at enforcement. |

## Liveness profiles (behavior × role)

Policy varies by **behavior** (`write`, `review-debate`, `human`, …) and **role**
(model-resolution key). There is no v2 contract for one global `idleOutputTimeoutMs`
across all steps. Role taxonomy and step binding: [`role-resolution.md`](./role-resolution.md).

| Profile shape (category level) | Typical combination |
| --- | --- |
| Stall detection | Multi-category progress evaluation with a profile-specific stall budget. |
| Absolute ceiling (optional) | Hard cap on invocation wall-clock for bounded steps; open-ended steps may omit or set a generous ceiling. v1 runs idle detection and `iterationTimeoutMs` in parallel — that pairing is the contrast baseline, not the v2 default for every profile. |

Exemplars:

- **Open-ended — `implement` under `write`** — legitimate implementation passes may
  run long with sparse output when workspace activity or markers show progress; stall
  budgets tolerate slow compile/test stretches; an absolute ceiling may still exist but
  is not the primary stall detector.
- **Short bounded — `actuator` in `review-debate`** — verdict application is a
  bounded edit pass; a true stall must not default to soaking a 30-minute iteration
  wall. Tighter stall detection and a lower absolute ceiling than open-ended
  `implement` are expected at enforcement.
- **Read-only debate — `adversary` / `advocate` / `adjudicator`** — progress is
  artifact-oriented (review output), not repo writes; stall expectations differ from
  `actuator`/`implement` writers.

Profile tables (numeric thresholds per behavior × role) are deferred to the first
enforcement consumer.

## Guarantees

What v2 promises operators across profiles — without pinning algorithms or timeout
tables:

**During legitimate long work**

- Slow work is not misclassified as stall merely because stdout is quiet when other
  progress signals are active.
- Orchestration may remain live (`isLive`) while an invocation runs; liveness
  evaluation does not require the operator to hand-finalize productive silent work.

**At termination**

- True stall terminates the invocation within a profile-appropriate bound — not by
  default riding an open-ended 30-minute wall on short bounded steps.
- Stall termination is **not quota exhaustion**; binding advance on stall is separate
  from quota fallback. Quota still advances only on `quota` results per
  [`shared-invocation.md`](./shared-invocation.md).
- When stall triggers binding advance and later rungs remain, the operator sees
  advance as a stall recovery path, not a quota rotation (exact stderr phrasing
  deferred to enforcement).
- When stall is terminal, the outcome is a stall failure distinct from quota,
  `model_config`, and generic `error` — `failureKind`/telemetry encoding deferred to
  enforcement.

**Ownership**

- Liveness policy is evaluated in the **shared invocation layer** — one policy
  surface, not per-phase watchdog copy-paste in patch, review-debate, or shrink
  loops. Workflow loops consume the policy; they do not reimplement it.

## Deferred to first enforcement consumer

Pin when shared invocation implements liveness enforcement:

- Signal algorithms, weights, sampling intervals, and timeout tables per profile.
- Operator-visible stall diagnostics at termination (forensics beyond
  pre-termination in-flight observability).
- Human-step interaction with invocation stall termination (Phase 6 `human` behavior).
- `failureKind` and telemetry fields for stall vs quota vs other terminal stops.

## Decisions

- **Shared-invocation-owned** — no duplicate watchdog wiring per behavior loop.
- **Behavior × role profiles** — no single global idle timer as the v2 contract.
- **Multi-category progress** — outcome-oriented, not stdout-only.
- **Category-level stall response** — terminal abort, binding advance, or role-dependent
  mix; kill paths invented at enforcement.
- **Policy before Phase 6 review-debate port** — see [`v2-build-order.md`](./v2-build-order.md).
