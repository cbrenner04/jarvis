# Classify credential/auth failures as rotate-to-next-agent

## Problem

A revoked/expired agent credential (codex sample: `Your access token could not
be refreshed because your refresh token was revoked. Please log out and sign in
again.`) terminates the run instead of rotating to the next configured agent,
even when later agents are healthy. Operationally this is like quota — *this*
agent can't run now, another can. Classification is **stderr-driven** in
`v1/src/agents/spawn.ts` (order: model_config → quota → error). The captured
codex sample matches **none** of the `modelConfigurationPatterns`, so the real
path today is `kind: "error"` → run terminates. Fatal `model_config` is only a
secondary path (an auth message that incidentally contains a model word).
Neither rotates. (The codex exit code is unconfirmed by the captured sample;
classification keys on stderr.)

## Decisions

- New classifier `isCredentialAuthSignal(name, exitCode, stderr)` in `v1/src/agents/quota.ts`. Signatures match **durable** auth phrasing only: refresh-token-revoked / log-out-and-sign-in / re-authenticate. Rules out reusing `modelConfigurationPatterns`, which must stay fatal.
- **Drop bare `401`/`unauthorized` from the rotation signal.** A one-off `401` blip is transient, not durable credential loss; rotating on it permanently burns a healthy agent for the whole run (auth is classified to the quota kind at spawn, which has no retry — see precedence below). Rules out the false-positive that converts a recoverable blip into permanent agent loss.
- Patterns are **scoped to the agent they are evidenced for**: codex (the only captured sample). No speculative cross-agent patterns. `Deferred to first consumer: per-agent durable phrasing for claude/cursor — pin when a real sample is captured`. Any future shared pattern admits only unambiguous durable phrasing. Rules out broad cross-agent matching, the origin of false positives.
- **Precedence: transient → auth → model_config → quota.** A transient signal wins, so stderr matching both auth and a transient transport phrase falls to `kind: "error"` and retries the same agent first (the existing transient path, `kind: "error"` only). Auth is checked before model_config (defense-in-depth: an auth message containing a model word). Durable auth phrasing does not overlap transient phrasing, so this is mostly belt-and-suspenders, but it is committed, not left implicit.
- Auth failures route through the **existing quota rotation path** (rotate per-agent; exit 2 on exhaustion), distinguished by a marker on the quota-classified result. Rules out a new `kind: "auth"` whose blast radius would touch every `kind === "quota"` site across patch/plan/prompt/review.
- **Marker contract:** add optional `authFailure?: true` to the `{ kind: "quota" }` variant of `AgentResult` (`v1/src/agents/types.ts`) — a change to the shared discriminated union. Existing `kind === "quota"` consumers ignore it; only the re-auth note (subspec 01) reads it. The offending **agent name is not on the result**; it is already supplied separately at each emit point (per-emit-point `agent`/`agentName` arg), and the note pairs the marker with that name.
- **Known limitation:** riding the quota path means telemetry cannot distinguish auth from quota; only the stderr note (subspec 01) carries the distinction. Accepted to keep blast radius bounded.
- Genuine model-id misconfig (unsupported/typo'd id) stays `model_config` exit 3 — only credential/session errors rotate.

## Task checklist

- [ ] Add `isCredentialAuthSignal` + codex-scoped durable auth patterns to `v1/src/agents/quota.ts` (no bare `401`/`unauthorized`).
- [ ] Add `authFailure?: true` to the `{ kind: "quota" }` variant in `v1/src/agents/types.ts`.
- [ ] In `spawn.ts`, classify in order transient → auth → model_config → quota; emit a quota-classified result with `authFailure: true` for durable auth stderr.
- [ ] Unit tests in `v1/test/agents/quota.test.ts`: codex revoke sample → auth; `unknown model` → not auth (stays model_config); bare `401`/`unauthorized` → not auth (stays error, retry-eligible).
- [ ] Spawn/integration test: durable auth stderr surfaces as quota-path with `authFailure: true`, not `model_config`/terminal `error`; a stderr matching both auth and transient retries the same agent first.
- [ ] Patch + plan rotation test: auth failure on the current agent advances to the next configured agent.

## Acceptance criteria

- [ ] An agent CLI failure whose stderr matches a durable credential/sign-in-required signature rotates to the next configured agent instead of terminating the run. Classification is global (the shared spawn classifier), so rotation occurs on any quota-rotation path; verified by tests in patch (`jarvis run`) and plan (`jarvis plan`) as representatives.
- [ ] A transient-looking blip (bare `401`/`unauthorized`, or stderr matching both auth and a transient signal) does **not** rotate on the first failure — it stays `kind: "error"` and is eligible for the existing same-agent transient retry.
- [ ] A genuine model-id misconfiguration still terminates fatally (exit 3, `model_config`) with no rotation — existing `isModelConfigurationSignal` tests in `v1/test/agents/quota.test.ts` stay green.
- [ ] When every agent is exhausted by auth and/or quota, the run terminates via the existing quota-exhaustion path (exit 2), not exit 3.

## Documentation updates

- `v1/docs/quota-signals.md`: add a credential/auth classification section; add a matrix row mapping an auth signal to rotate-to-next (exit 2 on exhaustion); add a `Pattern audit` subsection for the new patterns with the captured codex sample.
- `v2/docs/v1-behaviors.md`: record that credential/auth CLI failures now rotate (quota path) rather than terminating — this changes existing classification behavior.
