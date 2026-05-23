---
id: patch.prompt.body
behavior: agent-facing
kind: template
revision: 1
---
Inspect the target repo for guidance, conventions, and relevant docs.
Read the spec at <SPEC_PATH>.
<SIBLINGS_BLOCK>
Follow these Jarvis rules:
<PATCH_RULES>
Pick the single most important unchecked task and complete it.
