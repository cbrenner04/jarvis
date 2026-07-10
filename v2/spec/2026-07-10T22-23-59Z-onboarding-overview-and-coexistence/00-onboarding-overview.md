# Onboarding overview page

A single "start here" page for a newcomer: what jarvis is, the two coexisting
binaries and when to reach for each, the user-level v2 vocabulary, and a link
map into install / first-run / deeper references. Orientation, not design
reference — terse and link-first, no duplication of existing docs.

Today README jumps straight into install and commands; nothing orients a new
reader to the `jarvis1` vs `jarvis` split or the v2 vocabulary.

## Decisions

- Home: `v2/docs/onboarding.md`. Rules out a new root `docs/` dir and burying it as a README section — it is a distinct front-door page and v2/docs already hosts the coexistence narrative it links into.
- Add exactly `v2/docs/onboarding.md` to the `.markdownlint-cli2.jsonc` `globs` so the page is guarded. Rules out leaving it unlinted (v2/docs is outside current globs); do not add `v2/docs/**` — that would newly lint unaudited existing v2 docs.
- Frame v2 as opt-in and in-progress (the `jarvis` binary currently answers `v2 not ready` / `--version`). Rules out presenting v2 as a ready orchestration layer a newcomer should adopt for daily work.
- Link-first: link to `v2/docs/` for workflow/behavior/role definitions rather than restating them. Rules out duplicating `v2-architecture.md` / `role-resolution.md` content.

## Task checklist

- [ ] Write `v2/docs/onboarding.md`.
- [ ] Add its path to `.markdownlint-cli2.jsonc` globs.
- [ ] Link it from README (intro + Documentation section).

## Acceptance criteria

- [ ] `v2/docs/onboarding.md` exists and states, at a user level, what jarvis is: it drives a coding-agent CLI against Markdown specs and does not implement an agent itself.
- [ ] The page names both binaries — `jarvis1` (stable v1 daily driver) and `jarvis` (v2) — says when to reach for each, and states that v2 is opt-in and never required.
- [ ] The page frames v2 as in-progress and does not instruct a newcomer to adopt `jarvis` for daily work (consistent with the binary currently answering `v2 not ready`).
- [ ] The page introduces the v2 vocabulary — workflows, behaviors, roles — at a user level and links to `v2/docs/` (e.g. `v2-vision.md`, `v2-architecture.md`, `role-resolution.md`) for the definitions rather than restating them.
- [ ] The page links out to install/setup, the first-run walkthrough, and the deeper `v2/docs/` references (README install + Quickstart, plus at least one `v2/docs/` doc).
- [ ] README links to the onboarding page from both its intro and its Documentation section.
- [ ] `bun run lint:md` passes with `v2/docs/onboarding.md` included in the linter globs.

## Documentation updates

- New: `v2/docs/onboarding.md` (this page).
- Edit: `README.md` — link the onboarding page from the intro and the Documentation section.
- Edit: `.markdownlint-cli2.jsonc` — add `v2/docs/onboarding.md` to `globs`.
- No `v2/docs/v1-behaviors.md` change: net-new doc, no existing behavior altered.
