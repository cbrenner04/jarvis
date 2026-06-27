---
name: wire-closeout-cost-emission-at-session-end
---

# Wire close-out cost emission into session end

## Problem

Session and operator CSV emission may exist as a standalone command, but the
runbook still describes manual assembly and session close (`jarvis1 cleanup`)
does not enforce populated cost sheets — so rows stay empty unless the operator
remembers.

## Direction

Make close-out cost emission the default session-end path and remove manual
assembly from operator docs.

**Command placement:** fold emission into `jarvis1 cleanup` close-out, or keep a
dedicated once-per-session command the runbook names explicitly — plan picks
one; the other path is not offered to the operator.

**Guardrail:** session close must not succeed silently with empty or stale cost
sheets for the active `report` — warn or block per plan; no silent skip.

**Operator flow:** running the chosen close-out path populates all four
`reports/*.csv` rows for the session (session emission + operator `/cost`
input) without hand-editing CSVs.

**Decisions**

- Manual CSV assembly is deleted from the runbook once emission ships — rules
  out keeping grep/paste instructions as the primary path.
- Guardrail attaches to the result, not a separate reminder — rules out
  runbook-only enforcement.
- One operator-facing close-out path — rules out requiring both cleanup and a
  second report command without documenting precedence.

Deferred to first consumer: exact guardrail severity (warn vs exit 1) — pin when
command placement is chosen.

## Documentation updates

- `v1/docs/operator-runbook.md` — Cost reporting standard: CSVs are emitted by
  the chosen command; delete manual-assembly framing.
- `v2/docs/v1-behaviors.md` — close-out cost-row emission command and
  session-end guardrail.

## Prerequisites

- Session cost and outcome rows can be emitted from jarvis telemetry for a report
- Operator cost and outcome rows can be emitted from operator `/cost` input for a report
