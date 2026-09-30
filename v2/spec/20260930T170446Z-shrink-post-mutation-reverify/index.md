# Shrink re-runs diff-derived mutation verification before publication

Post-completion shrink can delete co-located killing tests without an in-shrink mutation re-check; publication then fails `surviving_mutation_failed` with no recovery inside the shrink loop.

- [x] [00-shrink-in-loop-mutation-reverify.md](./00-shrink-in-loop-mutation-reverify.md)
- [x] [01-shrink-prompt-forbid-guard-test-deletion.md](./01-shrink-prompt-forbid-guard-test-deletion.md)
