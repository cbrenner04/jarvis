# Classify credential/auth failures as rotate-to-next-agent

## Problem

A revoked/expired agent credential (codex sample: `Your access token could not
be refreshed because your refresh token was revoked. Please log out and sign in
again.`) terminates the run instead of rotating to the next configured agent,
even when later agents are healthy. Operationally this is like quota — *this*
agent can't run now, another can. The spawn classifier (`v1/src/agents/spawn.ts`)
has no auth signature, so such stderr falls through to `kind: "error"` (or, if it
incidentally matches a `modelConfigurationPatterns` phrase, fatal `model_config`
exit 3). Neither rotates.

## Decisions

- New per-agent classifier `isCredentialAuthSignal(name, exitCode, stderr)` in `v1/src/agents/quota.ts`; signatures cover refresh-token-revoked / log-out-and-sign-in / re-authenticate / unauthorized-401 phrasing. Rules out reusing `modelConfigurationPatterns`, which must stay fatal.
- Auth is classified **before** model_config in `spawn.ts` order. Rules out the wrong-precedence bug where an auth message containing a model word lands as fatal model_config.
- Auth failures route through the **existing quota rotation path** (rotate per-agent; exit 2 on exhaustion), distinguished by a marker on the quota-classified `AgentResult` for messaging. Rules out a new `kind: "auth"` whose blast radius would touch every `kind === "quota"` site across patch/plan/prompt/review.
- Genuine model-id misconfig (unsupported/typo'd id) stays `model_config` exit 3 — only credential/session errors rotate.

## Task checklist

- [ ] Add `isCredentialAuthSignal` + auth pattern sets (shared + per-agent as needed) to `v1/src/agents/quota.ts`.
- [ ] In `spawn.ts`, classify auth before model_config/quota; emit a quota-classified result carrying the auth marker.
- [ ] Unit tests in `v1/test/agents/quota.test.ts`: the codex revoke sample classifies auth; a model-id phrase (`unknown model`) does not.
- [ ] Spawn/integration test: an auth-stderr failure surfaces as a rotate-to-next (quota-path) result, not `model_config`/terminal `error`.
- [ ] Patch + plan rotation test: auth failure on the current agent advances to the next configured agent.

## Acceptance criteria

- [ ] An agent CLI failure whose stderr matches a credential/auth/sign-in-required signature rotates to the next configured agent in both patch (`jarvis run`) and plan (`jarvis plan`), instead of terminating the run.
- [ ] A genuine model-id misconfiguration still terminates fatally (exit 3, `model_config`) with no rotation — existing `isModelConfigurationSignal` tests in `v1/test/agents/quota.test.ts` stay green.
- [ ] When every agent is exhausted by auth and/or quota, the run terminates via the existing quota-exhaustion path (exit 2), not exit 3.

## Documentation updates

- `v1/docs/quota-signals.md`: add a credential/auth classification section; add a matrix row mapping an auth signal to rotate-to-next (exit 2 on exhaustion); add a `Pattern audit` subsection for the new patterns with the captured codex sample.
- `v2/docs/v1-behaviors.md`: record that credential/auth CLI failures now rotate (quota path) rather than terminating — this changes existing classification behavior.
