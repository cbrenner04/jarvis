# Resumed mutation repair re-verifies HEAD before repairing

Plain `jarvis run resume` on review `surviving_mutation_failed` auto-derives `write.mutation-repair` from the terminal `loop_finished` survivor without diff-derived verification at current HEAD, so a committed killing test can still enter repair on a stale mutant.

- [x] [00-resume-mutation-head-reverify-before-repair.md](./00-resume-mutation-head-reverify-before-repair.md)
