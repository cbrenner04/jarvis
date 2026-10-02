---
name: config-confinement-policy-type-and-cascade
---

# Config policy type definition and per-project cascade

## Problem

A project has no way to request or declare a confinement policy. Without a policy type and cascade mechanism, adapters cannot be asked to honor one, and no invocation can record what policy was in effect.

## Decisions

- Confinement is expressed once as a small closed set of named vendor-agnostic policies, not vendor flags; plan must decide the policy names and the set (at minimum a strict filesystem-confined policy and an unconfined one).
- Policy resolves per project through the `projects.<projectKey>.overrides` block with a machine-level default, the same cascade shape and validation as `idleOutputTimeoutMs` and `agents`; plan must decide the key name.
- Unknown policy values are validation errors with clear naming of the config path, consistent with existing override validation.
- Plan must decide: what is the machine-level default policy value (e.g., `"unrestricted"`).
- Plan must decide: whether the default is opt-in or opt-out per operator setup.

## Prerequisites

- Machine config cascade shape exists for `projects.<projectKey>.overrides` (already true: `idleOutputTimeoutMs` and `agents` established the pattern)

## Acceptance criteria

- [ ] `machine-config-loader.test.ts`: a test proves project-level the policy override overrides machine default and that an unset project inherits machine default.
- [ ] `machine-config-loader.test.ts`: a test proves unknown policy values are rejected with a validation error naming the full config path.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — add the policy override key under `projects.<projectKey>.overrides` to the override block keys with valid values and semantics.

## Primary implementation surface

- `v2/src/config/machine-config-loader.ts` (policy type, validation, cascade resolution)
