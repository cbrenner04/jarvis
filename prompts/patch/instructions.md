---
id: patch.prompt.body
behavior: patch
kind: step
revision: 3
placeholders: [SPEC_PATH:string!, SIBLINGS_BLOCK:string!, PATCH_RULES:string!]
---
Inspect the target repo for guidance, conventions, and relevant docs.
Read the spec at <SPEC_PATH>.
<SIBLINGS_BLOCK>
Follow these Jarvis rules:
<PATCH_RULES>
Pick the single most important unchecked task and complete it.
