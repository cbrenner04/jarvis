# Run `check:fix` before `ready`

repo: cbrenner04/jarvis

The current PR-ready flow runs `bun run ready` as the final draft-to-ready gate, but it does not first apply Biome's safe write-mode fixes. That leaves branches failing the final `check` step for issues Jarvis could have fixed automatically immediately before the readiness gate. Keep the scope narrow: add a pre-ready `check:fix` step only in the existing patch-mode and plan-mode readiness helpers, preserve their current readiness preconditions, then update the workflow docs that describe that transition.

- [ ] [00 - Run `check:fix` immediately before the ready gate](./00-run-check-fix-before-ready.md)
- [ ] [01 - Document the pre-ready fixer workflow](./01-document-pre-ready-fixer.md)
