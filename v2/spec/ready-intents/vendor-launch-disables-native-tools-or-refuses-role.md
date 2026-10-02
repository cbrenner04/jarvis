---
name: vendor-launch-disables-native-tools-or-refuses-role
---

# Vendor launch disables native tools or refuses the role

> Hold: owner sign-off required before `plan`; the seed was marked not dispatchable and this split records the proposed direction only.

## Problem

Every adapter in `shared/invocation/agents.ts` launches with the vendor's native shell, edit, and search tools. Evidence (2026-09-29): cursor's shell wrapper hung at ~90% CPU for 10–15 min on trivial commands across 7–12 lanes, stranding iterations until an operator kill.

## Decisions

- Launch settings tighten from vendor defaults: native tools are disabled where the vendor supports it, only authorized Jarvis tools are exposed, and underlying filesystem and process sandboxing stays.
- No silent fallback to broader access: a vendor that cannot enforce the required restrictions is ineligible for that role and the binding is refused by name.
- Plan must decide, per vendor, the real flags that disable native tools and which vendors are eligible for which roles.

## Prerequisites

- A tool server endpoint exists to hand the agent at launch (delivered by: harness-tool-server-serves-role-scoped-tools)

## Acceptance criteria

- [ ] `agents.test.ts`: each eligible vendor's argv carries its tool-disabling form and the tool server endpoint; an ineligible vendor is refused before spawn with a named reason; fails against current code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — vendor capability requirements, eligibility per role, tightened launch settings.

## Primary implementation surface

- `shared/invocation/agents.ts`
