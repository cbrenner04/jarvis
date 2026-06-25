# Operator re-auth note on auth rotation

## Problem

When the run rotates past an agent because of an auth failure (subspec 00), the
existing quota fallback line (`quota exhausted; falling back`) misattributes the
cause to quota and never tells the operator *which* agent needs re-authentication
— the manual recovery step the north star wants the harness to surface.

## Decisions

- Emit a distinct one-line operator note naming the agent needing re-auth, gated on the auth marker from subspec 00, at the existing rotation emit points (patch quota fallback + `v1/src/modes/plan/emit-plan-quota-stderr.ts`). Rules out reusing the quota phrasing, which hides the auth cause and the agent name.
- Note string is a stable grep substring sharing no substring with quota/transient phrasing, defined as a constant in `v1/src/quota-harness-messages.ts` so patch and plan stay aligned. Rules out ad-hoc per-mode wording that drifts.
- Exhaustion line and telemetry are unchanged (auth rides the quota path).

## Task checklist

- [ ] Add a `harnessAuthRotateLine(agent)` constant/helper to `v1/src/quota-harness-messages.ts`.
- [ ] Emit it on auth rotation in patch and in `emit-plan-quota-stderr.ts` (plan prefixes `plan: <agent>:` as today).
- [ ] Tests assert the note appears, names the agent, and is absent for a plain quota rotation.

## Acceptance criteria

- [ ] On rotating past an agent for an auth failure, patch and plan each emit a one-line operator note naming that agent as needing re-authentication.
- [ ] The note is a stable grep substring distinct from `quota exhausted; falling back` and the transient-retry phrasing; a plain (non-auth) quota rotation does not emit it — `v1/test/modes/plan/emit-plan-quota-stderr.test.ts` stays green for the existing quota path.
- [ ] The run continues on the fallback agent after the note; final exhaustion still prints the existing `all agents quota-exhausted` line.

## Documentation updates

- `v1/docs/quota-signals.md` § Operator-visible stderr (grep contract): document the new auth-rotation note string and that it is emitted in addition to (not replacing) the per-agent rotation line.
