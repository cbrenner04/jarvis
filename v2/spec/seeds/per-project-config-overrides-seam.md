---
name: per-project-config-overrides-seam
---

# One per-project config-override seam instead of per-symptom fixes

## Problem

Three open asks are the same missing seam: per-project agent fallback order (#3026 — the machine-wide `agents` list is the only lever, and docs imply per-project variance), a per-project `idleOutputTimeoutMs` override (#3150's remaining half after the watchdog core fix #3218), and the readyCommand-per-project family that took a fix cascade to thread through one path at a time. Each got or will get a bespoke plumb; the 2026-09-05 queue audit called out that no entry proposes the seam itself.

## Decisions

- `projects.<key>` admits a bounded override block (start with `agents` and `idleOutputTimeoutMs`) that shadows the machine-wide value for runs on that project; resolution happens once at admission onto the immutable run/step config, not at read sites; rules out each override re-plumbing its own path (the dispatch-parity class, config edition).
- The override set is explicit and validated — unknown keys fail resolution with the config path named; rules out a general passthrough that silently absorbs typos.
- Existing machine-wide behavior with no override block is unchanged, pinned; rules out changing defaults while adding the seam.
- Single-operator scope: this is a per-target-repo lever, not multi-user config.

## Acceptance criteria

- [ ] A resolution test proves a project-level `agents` override shadows the machine list for that project's runs and only that project's, and an `idleOutputTimeoutMs` override reaches the watchdog arm; fails against the current machine-wide-only resolution.
- [ ] Unknown override keys fail resolution naming `projects.<key>.<field>`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — the override block, its keys, and resolution point.
- `v2/docs/agent-model-config.md` — per-project agent order.
