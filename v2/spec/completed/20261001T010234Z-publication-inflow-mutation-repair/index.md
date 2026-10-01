# Publication runs bounded mutation repair before terminal surviving_mutation_failed

Ready finalization can surface a publication-time surviving mutation while completion publication still settles terminal `surviving_mutation_failed` without an in-flow `write.mutation-repair` iteration.

- [x] [00-publication-inflow-mutation-repair-loop.md](./00-publication-inflow-mutation-repair-loop.md)
- [x] [01-mutation-repair-attempt-guards.md](./01-mutation-repair-attempt-guards.md)
