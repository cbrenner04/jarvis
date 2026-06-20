# Shared PR module with template narrative and deferred body updates

PR description logic is duplicated across patch and plan modes, the narrative agent runs on every subspec complete, and the PR body is rewritten per subspec instead of once at completion. Consolidate the duplicated PR module, default the narrative to a deterministic template, and defer the patch-mode body rewrite to the completion pipeline.

- [x] [00 — Shared PR module with template-default narrative](./00-shared-pr-template-narrative.md)
- [x] [01 — Defer patch PR body rewrite to completion pipeline](./01-defer-pr-body-to-completion.md)
