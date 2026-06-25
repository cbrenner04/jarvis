---
name: auth-error-rotates-to-next-agent
---

# Credential/auth failures rotate to the next agent instead of fatal exit 3

## Problem

A revoked/expired agent credential (e.g. codex: `your refresh token was
revoked. Please log out and sign in again.`) is classified `model_config` and
exits `3` fatally, never rotating to the next configured agent — even when
later agents in the order are healthy. Operationally an auth failure is like
quota: *this* agent can't run now, another can. It should rotate, not hard-stop.

## Behavior

- A credential/auth/sign-in-required CLI failure rotates to the next configured
  agent (same path as quota), instead of exiting `3`.
- Genuine model-configuration errors (unsupported/typo'd model id) stay fatal
  exit `3` — only credential/session errors rotate.
- When rotating past an agent for an auth failure, emit a one-line operator note
  naming the agent that needs re-auth; the run continues on the fallback.
- When all agents are exhausted by auth (and/or quota), the run terminates via
  the existing fallback-exhaustion path, not a fatal model-config stop.

## Out of scope

- Auto-re-authenticating an agent (interactive; operator's job).
- Genuine model-id misconfiguration changing classification.

## References

- `v1/docs/quota-signals.md` — per-agent classification + fallback matrix.
- `v1/src/agents/quota.ts` — classifier + `modelConfigurationPatterns`.
- `v1/src/modes/patch/run.ts`, `v1/src/modes/plan/run.ts` — exit-3 handling.

## Prerequisites

- Per-agent CLI-result classification distinguishes quota, model_config, and error kinds.
- A quota-classified result rotates the run to the next configured agent.
