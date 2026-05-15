# 02 — `jarvis config`, docs, cross-references

## Problem

`jarvis config` still reflects flat agent order. Docs and specs reference
`agentOrder` / `planAgentOrder`. After v2 lands, the CLI and documentation must
match the on-disk schema and avoid reintroducing optional fallback language.

## Decisions

- **`jarvis config` exposes both mode orders explicitly.** Replace
  `set-order` / `set-plan-order` (and related) with a **DRY** implementation:
  e.g. one internal helper parameterized by mode key plus subcommands
  `set-patch-order` and `set-plan-order` (exact names up to implementer, but
  must be clear and symmetric). `show` prints both `modes.patch.agentOrder`
  and `modes.plan.agentOrder`.
- **No `unset` that removes a mode order.** Both lists must always be present
  on disk for a valid config; subcommands only **set** (replace) an order.
  Remove any prior `unset-plan-order` / “fall back to agentOrder” UX.
- **Docs:** Update `docs/config.md` for v2 and mode orders; scan README if
  config examples appear.
- **Spec cross-references:** Update in-repo spec text that still describes
  `planAgentOrder` or flat `agentOrder` so future implementers are not misled
  (at minimum `spec/plan-mode-skeleton/index.md` and
  `spec/plan-mode-skeleton/04-plan-agent-order-config.md` — either replace
  with a pointer to this spec as superseding that shape, or adjust those files
  to describe v2 `modes.*` only, per your preference when implementing).

## Tasks

- [ ] Implement config subcommands + `show` for v2 `modes`.
- [ ] Update `docs/config.md` (and README if needed).
- [ ] Adjust stale spec files under `spec/plan-mode-skeleton/` that document
  the old keys so they match post-v2 reality.

## Acceptance criteria

- [x] `jarvis config show` reflects v2 `modes` only.
- [x] Setting either mode order validates the same way as the core config
  loader.
- [x] `docs/config.md` matches the implementation; no lingering `planAgentOrder`
  / flat `agentOrder` **as the authoritative schema** (historical mention OK if
  clearly labeled superseded).
- [x] `bun run typecheck`, `bun test`, `bun run check` pass.

## Documentation updates

- This subspec carries the doc and spec-pointer updates listed above.
