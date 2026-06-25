# Operator re-auth note on auth rotation

## Problem

When the run rotates past an agent because of an auth failure (subspec 00), the
existing rotation lines (`quota exhausted; falling back` and the lenient/plan
variants) misattribute the cause to quota and never tell the operator *which*
agent needs re-authentication — the manual recovery step the north star wants
the harness to surface. Because subspec 00's classification is global, **every**
rotation emit point — not just patch and plan — would show misleading quota
wording for an auth rotation; each must be covered or the spec under-delivers on
its own thesis.

## Decisions

- Emit a distinct one-line operator note naming the agent needing re-auth, gated on the `authFailure` marker (subspec 00), at **all** rotation emit points that branch on `kind === "quota"` and have the agent name in hand: patch strict quota fallback (`v1/src/modes/patch/iteration.ts` — the `HARNESS_QUOTA_FALLBACK_STRICT` block; auth is always strict-classified at spawn, never the lenient `noIterationProgress` path), patch shrink (`shrink.ts` `onQuotaFallbackEmit`), patch review (`review.ts` `onQuotaRotation`), prompt-mode (`v1/src/modes/prompt/run.ts`), and plan (`v1/src/modes/plan/emit-plan-quota-stderr.ts`). Rules out reusing the quota phrasing, which hides the auth cause and agent name on these paths.
- Review-mode (`v1/src/modes/review/run.ts`) emits only the exhaustion line, no per-agent rotation — nothing to add there.
- Note string is a stable grep substring sharing no substring with quota/transient phrasing, defined as one constant/helper `harnessAuthRotateLine(agent)` in `v1/src/quota-harness-messages.ts` so every emit point stays aligned. Rules out ad-hoc per-mode wording that drifts.
- Exhaustion line and telemetry are unchanged (auth rides the quota path; see subspec 00 known limitation).

## Task checklist

- [ ] Add a `harnessAuthRotateLine(agent)` helper to `v1/src/quota-harness-messages.ts`.
- [ ] Emit it on auth rotation (gated on `authFailure`) at each emit point above; plan prefixes `plan: <agent>:` as today.
- [ ] Tests assert the note appears and names the agent on auth rotation, and is absent for a plain quota rotation, across the covered emit points.

## Acceptance criteria

- [x] On rotating past an agent for an auth failure, each rotation path (patch run, shrink, review, prompt, plan) emits a one-line operator note naming that agent as needing re-authentication.
- [x] The note is a stable grep substring distinct from `quota exhausted; falling back`, the lenient line, and the transient-retry phrasing; a plain (non-auth) quota rotation does not emit it — `v1/test/modes/plan/emit-plan-quota-stderr.test.ts` stays green for the existing quota path.
- [x] The run continues on the fallback agent after the note; final exhaustion still prints the existing `all agents quota-exhausted` line.

## Documentation updates

- `v1/docs/quota-signals.md` § Operator-visible stderr (grep contract): document the new auth-rotation note string, the emit points that carry it, and that it is emitted in addition to (not replacing) the per-agent rotation line.
- `v2/docs/v1-behaviors.md`: record the new operator-visible auth-rotation stderr line (a new rotation message on every quota-rotation path).
