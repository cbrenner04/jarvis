# Split patch and plan god modules

Refactor-only: split `patch/run.ts` (~2.1k LOC) and `commands/plan.ts` (~1.5k LOC) into focused modules along landed behavior seams. No behavior change beyond file boundaries and imports.

- [x] [00 - Extract patch preflight](./00-patch-preflight.md)
- [ ] [01 - Extract patch completion pipeline](./01-patch-completion-pipeline.md)
- [ ] [02 - Extract patch iteration, thin run.ts](./02-patch-iteration-thin-run.md)
- [ ] [03 - Extract plan orchestration, args-only command](./03-plan-orchestration.md)
