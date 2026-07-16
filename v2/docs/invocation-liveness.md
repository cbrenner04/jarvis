# Invocation liveness

Behavioral contract for **stall** (process up, no useful progress toward the step
outcome) vs **slow work** (long but legitimate) during one agent invocation. Shared
invocation now detects stdout/stderr-only stalls when a caller supplies an
`idleOutputMs` budget; workflow loops consume outcomes. Workspace and marker signals,
profiles, and stall-driven binding advance remain deferred.

Related: [`shared-invocation.md`](./shared-invocation.md), [`role-resolution.md`](./role-resolution.md),
[`v1-behaviors.md`](./v1-behaviors.md).

When a run hangs before structured log records accrue, read the invocation session
log first: `~/.jarvis/sessions/<run-id>-<timestamp>.log` (one file per write-loop
iteration; see [`daemon-host.md`](./daemon-host.md#invocation-session-logs)).

## Terminology

| Term | Meaning |
| --- | --- |
| **Invocation liveness** | Whether a step invocation is making outcome-relevant progress. |
| **Run orchestration liveness** | Whether the run loop Promise is still executing (`isLive`). See [`daemon-host.md`](./daemon-host.md). |

`isLive` ≠ invocation liveness: orchestration can be live while an invocation stalls.

## Definitions

**Slow work** — the agent is running and at least one progress signal (below) moves
toward the step outcome within the invocation's liveness profile.

- **`actuator` applying a verdict** — edits on verdict targets; sparse stdout OK.
- **`implement` under `write`** — touches acceptance-criteria files, runs tests, or
  advances the step artifact; compile/test silence OK when workspace or markers move.
- **Read-only debate** (`adversary`, `advocate`, `adjudicator`) — produces review
  artifacts via **agent output** and **step-completion markers**; no repo writes.

**Stall** — process still up but no progress signal moves toward the outcome longer
than the profile's **stall budget** (bounded span without outcome-relevant progress
before stall is declared).

Negative candidate: no output, no outcome-relevant workspace movement, no
step-completion marker advance for the full **stall window** (illustrative span for
negative examples; enforcement sets concrete values — e.g. hung tool call with zero
activity). Long test runs with periodic mtime or marker updates are not stalls.

## Progress signal categories

Multi-category, outcome-oriented; weights, intervals, and thresholds deferred to
first enforcement consumer.

| Category | Meaning |
| --- | --- |
| **Agent output** | Stdout/stderr (or adapter-equivalent stream). |
| **Workspace activity toward step outcome** | Cwd changes plausibly advancing the step (edits, test artifacts, review writes). |
| **Step-completion markers** | Harness-observable step advance (outcome token, contract check, role artifact). |

Read-only debate roles (`adversary`, `advocate`, `adjudicator`) progress via **agent
output** and **step-completion markers** only — not workspace activity. The
workspace row applies when the resolved role may write toward the step outcome
(`actuator`, `implement` under `write`, etc.).

v1 ≈ `max(output idle, file idle)` under one global `idleOutputTimeoutMs` plus
`iterationTimeoutMs` — [`v1-behaviors.md`](./v1-behaviors.md). Shared v2 currently
enforces caller-supplied stdout/stderr idle budgets only.

## Stall-response categories

Recorded at policy level; kill-path wiring deferred.

| Category | Meaning |
| --- | --- |
| **Terminal abort after bounded stall** | No later rungs and no **profile continuation** (no further binding rung or retry permitted by the profile after stall) — stall failure, not quota. |
| **Binding advance when later rungs remain** | Stall advances the binding chain; not quota exhaustion. |
| **Role-dependent mix** | Read-only debate roles may terminate without advance; writers may advance when rungs remain. |

## Liveness profiles (behavior × role)

Policy varies by **behavior** and **role** — no global `idleOutputTimeoutMs`. Taxonomy:
[`role-resolution.md`](./role-resolution.md).

Each profile combines **stall detection** (multi-category, profile-specific budget)
and an optional **absolute ceiling** (bounded steps; v1's parallel idle + wall is the
contrast baseline, not the v2 default everywhere). Profile tables deferred.

Exemplars:

- **Open-ended — `implement` under `write`** — long passes with sparse output when
  workspace or markers show progress; ceiling secondary to stall detection.
- **Short bounded — `actuator` in `review-debate`** — verdict apply must not soak a
  30-minute wall; tighter stall detection and lower ceiling than open-ended implement.
  Step metadata may tighten stall detection and ceiling beyond behavior defaults
  (e.g. review-debate vs plan actuator context).
- **Short bounded — `implement` in bounded contexts (e.g. shrink)** — must not inherit
  open-ended `implement` under `write` stall/ceiling wholesale; profile tables land at
  the enforcement consumer.
- **Read-only debate** — artifact-oriented progress via output and markers; stall
  expectations differ from writers.

## Guarantees

**During legitimate long work**

- Quiet stdout does not imply stall when other progress signals are active.
- Productive silent work does not require operator hand-finalize.

**At termination**

- True stall ends within a profile-appropriate bound — not by default a 30-minute wall
  on short bounded steps.
- Stall ≠ quota; binding advance on stall is separate from quota fallback ([`shared-invocation.md`](./shared-invocation.md)).
- Stall advance reads as stall recovery, not quota rotation; terminal stall is distinct
  from quota, `model_config`, and generic `error` (`failureKind` deferred).

## Deferred to first enforcement consumer

- Workspace and step-marker signal algorithms, weights, intervals, and timeout tables per profile.
- **Profile context plumbing** — behavior, resolved role, and step metadata supplied
  into shared invocation for profile selection (including metadata-tightened bounds).
- **Stall-driven binding advance** — contract extension beyond quota-only fallback:
  stall recovery advances the binding chain; classification vs quota rotation at
  termination (`failureKind`/telemetry).
- **Stall advance traversal** — stall advance walks the flat binding chain (inner
  agent rungs + outer bindings), not v1 patch's outer-`agentOrder`-only idle
  escalation.
- **Bounded `implement` profiles** — contexts such as shrink must not inherit
  open-ended `implement` under `write` bounds wholesale.
- Operator-visible stall diagnostics at termination.
- Human-step stall interaction (Phase 6 `human` behavior).
- `failureKind` / telemetry for stall vs quota vs other stops.
