# Squash state store migrations to a baseline schema

Twenty-eight sequential SQLite migrations in `state-store.ts` add review drag on a single-machine store. Persistence also carries local `isRecord` and shrink-suffix literals in `workflow-run-status-rollup.ts`, and the default SQLite path is re-derived inline instead of through `paths.ts`.

- [x] [00 - Shared isRecord and shrink step-id helpers](./00-shared-is-record-and-shrink-step-id.md)
- [x] [01 - Orchestration store path constant](./01-orchestration-store-path.md)
- [x] [02 - Squash state store migrations to baseline schema](./02-squash-state-store-migrations.md)
- [ ] [03 - State store baseline documentation](./03-state-store-baseline-docs.md)
