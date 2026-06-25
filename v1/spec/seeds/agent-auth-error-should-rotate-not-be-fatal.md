---
name: agent-auth-error-should-rotate-not-be-fatal
---

# A revoked/expired agent auth token hard-stops the run instead of rotating

## Problem

When an agent's credentials are revoked or expired mid-session, the run dies
instead of falling through to the next agent in the order. Observed this session:
codex's refresh token was revoked (`Your access token could not be refreshed
because your refresh token was revoked. Please log out and sign in again.`), and
the run exited `3` (`model_config` / agent-error) — a **fatal** classification
that does not rotate to the next configured agent. A `spec-reset` run was killed
this way even though claude and cursor were available behind codex.

An auth failure is operationally identical to quota exhaustion — *this* agent
can't run right now, but another can. Quota signals rotate; auth-revoked /
sign-in-required errors should too, instead of being lumped with genuine
model-misconfiguration (a wrong/unsupported model id) as fatal.

The current workaround is operator-only: notice the exit-3, then hand-edit
`config.json` to drop the broken agent so runs fall back cleanly — a manual step
the north star wants the harness to own.

## Direction

Classify a credential/auth failure as a rotate-to-next-agent signal, not a fatal
`model_config` stop. Options for plan to weigh:

- Add auth/sign-in-required stderr signatures to the quota-like rotation
  heuristics (per-agent), so the run advances to the next agent rather than
  exiting `3`.
- Keep genuine `model_config` (unsupported/typo'd model id) fatal — only
  credential/session errors rotate.
- Surface a clear one-line operator note naming the agent that needs re-auth,
  while the run continues on the fallback.

## Out of scope

- Genuine model-configuration errors (unsupported model id) staying fatal.
- Auto-re-authenticating an agent (interactive; operator's job).

## References

- `v1/docs/quota-signals.md` — per-agent classification + fallback matrix.
- Patch/plan `model_config` exit `3` handling in `v1/src/modes/patch/run.ts`
  and `v1/src/modes/plan/run.ts`.
- Observed 2026-06-24: codex token revocation killed a `spec-reset` run.
