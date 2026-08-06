---
id: plan.prompt.pr-description
behavior: plan
kind: step
revision: 3
placeholders: [INTENT:string!, SPEC_CONTEXT:string!]
add: [shared.pr-description]
---
You are generating a PR description for a Jarvis plan-mode specification.

**Intent:**

<INTENT>

**Specification context:**

<SPEC_CONTEXT>

Based on the plan and work done in this specification, author the PR description.
