---
name: adapter-confinement-translation-and-refusal
---

# Adapters translate confinement policy to vendor flags and refuse unsupported policies

## Problem

Adapters hardcode vendor-specific confinement flags with no mechanism to check whether those flags honor a requested policy. An adapter that cannot deliver the requested confinement silently degrades instead of refusing the binding, making quota fallback change confinement mid-spec without operator visibility.

## Decisions

- Each adapter (claude, codex, cursor) translates a resolved confinement policy into its own vendor flags; the translation is deterministic and stateless, taking policy as input and returning the translated argv.
- An adapter that cannot translate the requested policy into working flags for that vendor throws a named refusal error before invoking the agent, rather than proceeding with degraded confinement; the error surfaces in the binding attempt and causes quota fallback.
- The translation itself is pure and internal to `createResolvedAgentBinding`; callers pass policy via `ResolvedAgentBindingOptions` and receive a binding that either invokes with translated flags or refuses.
- Defaults preserve today's behavior: the default policy translates to byte-identical argv for every adapter under today's hardcoded flags; plan must decide the timeline and mechanics of retiring `codexSandboxMode` in favor of policy.

## Prerequisites

- Confinement policy type and validation exist (delivered by: config-confinement-policy-type-and-cascade)

## Acceptance criteria

- [x] `agents.test.ts` (or a test file covering agent binding): a test proves each of the three adapters (claude, codex, cursor) generates byte-identical argv under the default policy as today's hardcoded invocation; it fails against any change in default policy translation.
- [x] Same file: a test proves an adapter refusing an unsupported policy throws a named error before invoking the subprocess; it fails against the current unconditional invoke.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:shared` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — explain the confinement policy concept, the config cascade (machine default overridable per project via the policy override key under `projects.<projectKey>.overrides`), and add a table showing each adapter's policy-to-flags translation for each policy value in the default set.
- `v2/docs/v1-behaviors.md` — record the policy translation layer (new structure) and that defaults are unchanged from v1.

## Primary implementation surface

- `shared/invocation/agents.ts` (`createResolvedAgentBinding` signature, adapter-specific translation logic, refusal throwing)
