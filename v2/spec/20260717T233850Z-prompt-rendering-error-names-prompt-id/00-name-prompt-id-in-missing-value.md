# Name the prompt id in the missing_value message

## Problem

`renderTemplateWithDeclarations` (`shared/prompts/render.ts`) throws
`missing_value` `PromptRenderingError` with message: "Required placeholder \`<SPEC_PATH>\` has no value".
When this surfaces through a v2 run as `run_execution_failed`, the operator sees the
token but not which prompt was being rendered, so there is no way to tell which prompt id
failed.

The rendering entry point already knows the id: `renderArtifactTemplate(artifact, values)`
holds `artifact.metadata.id`, but never passes it to the error site.

## Decisions

- Thread the prompt id through `renderArtifactTemplate` from `artifact.metadata.id`; do not require raw `renderTemplateWithDeclarations` callers to supply it. (Rules out editing every non-artifact caller — v1 patch/plan, `intent-split`, etc.)
- Add the prompt id as an optional argument to `renderTemplateWithDeclarations`; when absent the `missing_value` message is byte-unchanged. (Rules out breaking the existing message for raw callers and their pinned assertions.)
- Only the `missing_value` message names the prompt id. (Rules out reformatting the other `PromptRenderingError` reasons the intent does not scope.)

## Task checklist

- Add an optional prompt-id parameter to `renderTemplateWithDeclarations`.
- Pass `artifact.metadata.id` from `renderArtifactTemplate`.
- Include the prompt id alongside the token in the `missing_value` message when the id is present.
- Add/extend a test asserting the message names both id and token; keep the raw-caller assertion green.
- Update the message contract in `v2/docs/prompts.md`.

## Acceptance criteria

- [x] A `missing_value` `PromptRenderingError` raised through `renderArtifactTemplate` names both the prompt id (`artifact.metadata.id`) and the missing placeholder token in its message.
- [x] A new or updated test in `shared/prompts/render.test.ts` asserts the `missing_value` message from an artifact render contains both the prompt id and the token; it fails against the pre-fix code and passes after.
- [x] The existing `render.test.ts` `Required placeholder \`<BB>\` has no value` assertion (raw `renderTemplateWithDeclarations` caller, no prompt id) stays green.
- [x] `v2/docs/prompts.md` records the `missing_value` message contract: prompt id + missing placeholder token.

## Documentation updates

- `v2/docs/prompts.md` "Placeholder and delimiter contract" section: state that a `missing_value` failure names the prompt id and the missing placeholder token.
