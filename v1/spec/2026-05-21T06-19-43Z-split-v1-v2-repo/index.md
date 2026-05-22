# Split Repo Into `v1/` and `v2/`

repo: cbrenner04/jarvis

Split the current single-tree repository into a root compatibility layer plus sibling `v1/` and `v2/` directories. The outcome of this spec is structural only: `jarvis` continues to behave exactly as it does today, but the current product implementation lives under `v1/` and v2 planning material lives under `v2/spec/`.

Recommended implementation order: land the physical relocation first, then repoint the root compatibility layer and TypeScript ownership, then finish with docs and verification once the final paths are stable. Each subspec should leave the repo in a coherent intermediate state; later slices may refine ownership and docs but should not rely on undeclared cleanup.

- [ ] [00 - Relocate v1-owned trees and seed the v2 skeleton](./00-relocate-v1-and-seed-v2.md)
- [ ] [01 - Repoint root entrypoints and TypeScript ownership to v1](./01-root-compatibility-and-tsconfig.md)
- [ ] [02 - Update repo docs, spec topology, and verification for the split](./02-docs-specs-and-verification.md)
