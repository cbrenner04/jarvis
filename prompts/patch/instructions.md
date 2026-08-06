---
id: patch.prompt.body
behavior: patch
kind: step
revision: 12
placeholders: [SPEC_PATH:string!, SIBLINGS_BLOCK:string!, REPO_GUIDANCE:string!, ACTIVE_SUBSPEC_PATH:string!, ACTIVE_SUBSPEC_BODY:string!, PATCH_RULES:string!, TIMEOUT_CHECKPOINT_CONTEXT:string!, STEP_RULES:string!]
---
Read the spec at <SPEC_PATH>.
<SIBLINGS_BLOCK>
## Repo Guidance

<<<REPO_GUIDANCE_BEGIN>>>
<REPO_GUIDANCE>
<<<REPO_GUIDANCE_END>>>

## Active Subspec

<<<ACTIVE_SUBSPEC_BEGIN>>>
<ACTIVE_SUBSPEC_PATH>
<ACTIVE_SUBSPEC_BODY>
<<<ACTIVE_SUBSPEC_END>>>

## Timeout Checkpoint

<<<TIMEOUT_CHECKPOINT_BEGIN>>>
<TIMEOUT_CHECKPOINT_CONTEXT>
<<<TIMEOUT_CHECKPOINT_END>>>

Follow these Jarvis rules:
<PATCH_RULES>

<STEP_RULES>
