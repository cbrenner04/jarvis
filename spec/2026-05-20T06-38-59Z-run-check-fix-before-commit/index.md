# Run `check:fix` before `ready`

repo: cbrenner04/jarvis

The current `bun run ready` gate runs `install → typecheck → test → check` without first applying Biome's safe write-mode fixes, so branches can fail readiness on auto-fixable issues. Fix this by prepending `check:fix` to the command sequence in `scripts/ready.ts` — a one-line change that covers both patch-mode and plan-mode readiness paths automatically — then update the workflow docs to reflect the new first step.

- [x] [00 - Run `check:fix` immediately before the ready gate](./00-run-check-fix-before-ready.md)
- [ ] [01 - Document the pre-ready fixer workflow](./01-document-pre-ready-fixer.md)
