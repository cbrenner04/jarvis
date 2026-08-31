# Admit external implement specs

`jarvis run workflow implement` rejects durable plan trees that `planSource` publishes under `~/.jarvis/specs/<project-safe-id>/plans/` because those trees live outside every registered repository root.

Ordered: `01`–`03` depend on `00` resolving external plan identity; `04` documents the landed behavior.

- [ ] [00 - Admit external plan spec paths](./00-admit-external-plan-spec-paths.md)
- [ ] [01 - Skip base-ref membership for external plan specs](./01-skip-base-ref-for-external-plan-specs.md)
- [ ] [02 - Preflight external plan tree completeness](./02-preflight-external-plan-tree-completeness.md)
- [ ] [03 - Incomplete external plan re-run preflight](./03-incomplete-external-plan-rerun-preflight.md)
- [ ] [04 - Document external plan implement admission](./04-document-external-plan-implement-admission.md)
