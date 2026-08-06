---
id: patch.prompt.pr-description
behavior: patch
kind: step
revision: 3
placeholders: [SPEC_PATH:string!, SPEC_CONTEXT:string!]
add: [shared.pr-description]
---
You are generating a PR description for a Jarvis patch-mode specification.

**Specification context:**

<SPEC_CONTEXT>

**Specification file:** <SPEC_PATH>

Based on the work done in this specification and branch, author the PR description.
