---
name: v2-src-layout-contract
---

# v2/src layout contract

Pin the role-based `v2/src/` domain map, import-direction rules, and entrypoint policy in durable docs before module moves land.

## Decisions

- Organize by architectural role from `v2-architecture.md`, not filename prefixes — rules out `tui-*` / `daemon-*` sibling directories at `v2/src/` root.
- Pin one directory per domain (execution library, persistence library, daemon host, TUI host, CLI host); `ipc/` and `testing/` stay in place — rules out a parallel `v2/test/` tree or re-homing those subtrees.
- Document allowed import flow (hosts → libraries → `shared/`; `ipc/` → `shared/` only; `testing/` → anything) in `v2-architecture.md` **Source layout** — rules out duplicating the matrix across per-domain docs.
- Entrypoints: keep `v2/src/cli.ts` and `v2/src/daemon-entrypoint.ts` at `v2/src/` root, or relocate each with every caller (`bin/jarvis`, `daemon-lifecycle` default spawn) updated in the same subspec — rules out stale hard-coded paths.
- No barrel `index.ts` re-export layers — rules out hiding dependency graphs behind host facades.
- Deferred to first consumer: exact directory basenames under each domain — pin in **Source layout** when this intent drafts (every current root file must map to exactly one domain).

## Prerequisites

## Documentation updates

- `v2/docs/v2-architecture.md` — add **Source layout** (domain→directory map, import rules, entrypoint policy).
- `v2/docs/v2-vision.md` — replace flat `v2/src/*.test.ts` note with co-located-by-domain convention.
- `v2/docs/v2-build-order.md` — replace Phase 0 flat-root scaffold wording if still present.
