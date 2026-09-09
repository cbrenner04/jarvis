# Test-seam guard verified against real source

`scripts/guard-production-test-flags.ts` exits 0 on `main` while four `*ForTest` seams sit in `v2/src`: its brace-window regexes cannot cross a nested `}` or `>`, skip intersection-typed aliases, and only match exports with a literal `set` prefix. Ordered: `00` makes detection structural; `01` retires the seams the honest guard then reports so the clean tree stays green; `02` aligns docs and the write-step prompt with shipped enforcement.

- [x] [00 - Structural test-seam detection](./00-structural-test-seam-detection.md)
- [x] [01 - Retire production test seams](./01-retire-production-test-seams.md)
- [x] [02 - Align docs and prompt with enforced shapes](./02-align-docs-and-prompt-with-enforced-shapes.md)
