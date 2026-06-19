---
id: patch.prompt.body
behavior: patch
kind: step
revision: 4
placeholders: [SPEC_PATH:string!, SIBLINGS_BLOCK:string!, REPO_GUIDANCE:string!, ACTIVE_SUBSPEC_PATH:string!, ACTIVE_SUBSPEC_BODY:string!, PATCH_RULES:string!]
---
Before editing code, read the relevant durable docs/specs for the behavior you are changing.
When behavior, architecture, workflow, prompt, or operator-facing semantics change, update docs/specs in the same subspec in the durable home required by `v2/docs/documentation-standard.md`; do not defer doc alignment to a follow-up.
If the active subspec explicitly says docs are not required for a purely internal change, do not create speculative doc churn.

No planning labels in code.
Phase/milestone/slice names are sequencing artifacts; never put them in identifiers, filenames, types, or public API.
If a spec says "Phase 1 <thing>", the code should name the <thing>.

Be terse in communication artifacts (specs, PRs, commits, intents).
Verbosity costs money and review effort. Minimize it.
This does not authorize under-documenting code or omitting required docs.

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

Follow these Jarvis rules:
<PATCH_RULES>
