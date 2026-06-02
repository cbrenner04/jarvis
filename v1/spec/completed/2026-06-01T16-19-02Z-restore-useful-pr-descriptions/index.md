# Restore useful PR descriptions

## Decisions

- Put the shared PR-description wording in one prompt-registry fragment consumed by patch and plan PR-body generation; do not duplicate mode-local strings.
- Keep generated `Description` + `Decisions:` inside `jarvis:narrative` markers; do not add a second generated section outside the preserved rewrite surface.
- Keep the existing attribution footer mechanism unchanged and outside the model prompt; do not reopen footer rendering in this slice.
- Deferred to first consumer: whether removing `jarvis:narrative` markers is an explicit opt-out or an auto-repair case — pin when a caller needs it.

- [x] [00 - Shared PR-description prompt fragment](./00-shared-pr-description-prompt-fragment.md)
- [ ] [01 - Patch-mode generated narrative and preservation](./01-patch-mode-generated-narrative-and-preservation.md)
- [ ] [02 - Plan-mode adoption and PR-body docs](./02-plan-mode-adoption-and-pr-body-docs.md)
