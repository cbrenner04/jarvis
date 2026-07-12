---
name: v2-write-loop-prompt-audit
---

# Audit v2 write-loop prompts for missing file-output and done-token contract

Audit every v2 prompt rendered through a write-loop `write` step besides `plan.prompt.draft` and `intent.prompt.split` — including `patch.prompt.body`, `patch.prompt.shrink`, and any other implement or plan write paths. Fix render paths that reach `executeWrite` / terminal-token parsing without appending file-output instructions and step-completion rules. Document prompts that use direct invocation (review/debate critics and actuators) and are exempt from the write-loop terminal-token contract.

## Decisions

- Scope fixes to prompts whose runtime path goes through `executeWrite` and write-loop terminal-token parsing — rules out adding done-token suffixes to review/debate prompts that use direct `executeWithQuotaFallback`.
- Reuse shared suffix assembly where multiple write prompts need the same tail — rules out copy-pasting file-output blocks per prompt id.
- Record the exemption rule and full inventory in `v2/docs/prompts.md` — rules out leaving review prompts ambiguously subject to write-loop contract.

## Scope

- Inventory v2 prompt render call sites (`write.ts`, `review-debate-render.ts`, workflow step builders).
- Fix each write-loop-backed prompt id found missing the contract.
- Co-located tests per fixed render path.

## Out of scope

- Changing review/debate invocation semantics or verdict contracts.
- Governed prompt body edits when runtime suffix assembly suffices.

## Documentation updates

- `v2/docs/prompts.md` — inventory of which prompts carry the write-loop contract; rule that every write-behavior prompt rendered through the write loop must; explicit exemption for direct-invocation review/debate prompts.

## Prerequisites

- v2 plan draft prompt carries write-loop file-output suffix and step-completion rules via the shared plan-draft builder.
- v2 intent split prompt carries the same contract via `shared/prompts/intent-split.ts`.
