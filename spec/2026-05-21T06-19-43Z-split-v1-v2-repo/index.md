# Split Repo Into `v1/` and `v2/`

repo: cbrenner04/jarvis

Split the current single-tree repository into a root compatibility layer plus sibling `v1/` and `v2/` directories. The outcome of this spec is structural only: `jarvis` continues to behave exactly as it does today, but the current product implementation lives under `v1/` and v2 planning material lives under `v2/spec/`.

- [ ] [00 - Relocate v1-owned trees and seed the v2 skeleton](./00-relocate-v1-and-seed-v2.md)
- [ ] [01 - Repoint root entrypoints and TypeScript ownership to v1](./01-root-compatibility-and-tsconfig.md)
- [ ] [02 - Update repo docs, spec topology, and verification for the split](./02-docs-specs-and-verification.md)
