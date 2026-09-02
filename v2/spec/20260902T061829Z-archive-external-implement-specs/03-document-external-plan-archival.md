# Document external plan archival

## Problem

Operator docs describe stranded archival only for in-repo `v2/spec/` homes; the terminal lifecycle for external plan trees under `~/.jarvis/specs/<safeId>/plans/` is undocumented.

## Decisions

- Document external plan archival in `v2/docs/write-behavior.md` as the terminal artifact lifecycle for git-disabled plan publication and cross-link `jarvis cleanup`; rules out duplicating the full cleanup command reference.
- Document discovery, dry-run shape, refusal reasons, and `plans/completed/` destination in `v2/docs/operator-runbook.md`; rules out restating admission or execution routing from sibling specs.
- Record v2 external-plan archival as an additive behavior in `v2/docs/v1-behaviors.md` without changing v1; rules out implying v1 cleans external plan homes.
- Align prose with `00`–`02` behavior only; rules out documenting out-of-scope ready-intent cleanup or homestead migration.

## Tasks

- Update `v2/docs/write-behavior.md` with external plan archival as the terminal lifecycle, eligibility gates shared with in-repo specs, and a cross-link to operator cleanup.
- Update `v2/docs/operator-runbook.md` cleanup section with external-home discovery scope, `plans/<name> -> plans/completed/<name>` dry-run preview, refusal reasons, and post-archive layout.
- Add a v2 additive `v1-behaviors.md` entry for external plan archival with source paths.

## Acceptance criteria

- [ ] `v2/docs/write-behavior.md` defines external plan archival as the terminal artifact lifecycle and cross-links cleanup operations consistent with `00`–`02`.
- [ ] `v2/docs/operator-runbook.md` documents external-home cleanup discovery, dry-run preview shape, refusal reasons, and `plans/completed/` destination consistent with `00`–`02`.
- [ ] `v2/docs/v1-behaviors.md` records v2 external-plan archival behavior and states v1 does not perform this cleanup.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None beyond the acceptance criteria above.
