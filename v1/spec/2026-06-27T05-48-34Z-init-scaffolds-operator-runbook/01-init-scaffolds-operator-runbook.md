# jarvis init scaffolds OPERATOR_RUNBOOK.md

`jarvis init` today only registers the project and writes no files. This subspec
makes it also scaffold `OPERATOR_RUNBOOK.md` at the project root: a single rendered
document combining init-time facts with stubbed fill-in sections. Consumes the
stack-inference helper from 00.

## Decisions

- File is `OPERATOR_RUNBOOK.md` at the project root — a discoverable on-disk artifact, so its name and location are contract.
- Write only when the file is absent; an existing runbook is left byte-for-byte untouched. Rules out clobbering operator-filled stubs on re-run. Registration still happens either way.
- Seeded facts come from the config resolved at init time: repo path, origin URL, project key, inferred stack (00), `readyCommand`, `modes.plan.commit` mode, `modes.patch.agentOrder`, and `modes.patch.prNarrative` mode. A missing optional fact renders an explicit "not configured" note, not omission (e.g. no `readyCommand` → "not configured"; no origin → "no origin configured"). Rules out silent gaps that read as "not applicable."
- Document the spec-layout including the `commit:false` external `~/.jarvis/specs/<project>` ↔ symlink arrangement (a top confusion source).
- Repos-and-gates table is a seeded markdown table with columns `Repo | Path/URL | Gate`: one row for the target repo (path/URL, resolved `readyCommand` as its gate). Rules out an unverifiable freeform paragraph.
- Sandbox/network notes are static template prose (sandbox blindness — agent can't see rendered output; network-restricted runs), not per-project seeded. Jarvis has no per-project sandbox facts at init. Rules out fabricating project-specific sandbox config.
- Emergent sections (manual-finalize/recovery by exit reason, resume-first guidance, gate blind spots, cross-repo coordination) are stubbed with fill-in prompts. Jarvis must not fabricate recovery recipes it cannot know. Rules out inventing wrong procedures.
- Known-gotchas section is a baked template list curated from `v1/docs/operator-runbook.md`; each entry carries the jarvis issue URL already cited there (at minimum the `commit:false` external-spec ↔ symlink gotcha). Jarvis cannot discover gotchas from the project, so the list is template content, not seeded. Rules out an empty or unverifiable gotcha section.
- Headings are this stable, fixed set (exact text, in order) so other behaviors can reference sections by name. Rules out churned heading text breaking references:
  - `## Project facts`
  - `## Spec layout`
  - `## Repos and gates`
  - `## Sandbox and network`
  - `## Known gotchas`
  - `## Manual finalize and recovery`
  - `## Resume-first guidance`
  - `## Gate blind spots`
  - `## Cross-repo coordination`
- Generalizes `v1/docs/operator-runbook.md`; that file is not read or written by init.

## Task checklist

- [ ] Render the runbook (seeded + stubbed sections) and write it during `jarvis init` when absent.
- [ ] Update `init.test.ts` file-creation assertions to expect `OPERATOR_RUNBOOK.md`; keep registration assertions.
- [ ] Add tests for content coverage, the "not configured" path, idempotent no-clobber, and stable headings.

## Acceptance criteria

- [x] `jarvis init` on a registered project with no existing runbook writes `OPERATOR_RUNBOOK.md` at the project root, and writes no other files.
- [x] The rendered runbook includes repo path, origin URL (or a "no origin configured" note when absent), project key, inferred stack, `readyCommand` (or a "not configured" note when absent), `modes.plan.commit` mode, `modes.patch.agentOrder`, and `modes.patch.prNarrative` mode.
- [x] The runbook explains the spec-layout including the `commit:false` external `~/.jarvis/specs/<project>` ↔ symlink arrangement.
- [x] The runbook contains a repos-and-gates table with columns `Repo | Path/URL | Gate` and a row for the target repo whose gate is the resolved `readyCommand`.
- [x] The runbook contains static sandbox/network notes covering sandbox blindness and network-restricted runs.
- [x] The runbook contains stubbed sections with fill-in prompts for manual-finalize/recovery by exit reason, resume-first guidance, gate blind spots, and cross-repo coordination, and does not auto-write recovery recipes jarvis cannot know.
- [x] The runbook contains a known-gotchas section with at least the `commit:false` external-spec ↔ symlink gotcha, and every gotcha entry links to a jarvis issue URL.
- [x] The runbook uses exactly the fixed section headings listed in Decisions, in order.
- [x] Re-running `jarvis init` when `OPERATOR_RUNBOOK.md` already exists leaves the file byte-for-byte untouched.
- [x] `jarvis init` still registers the project (root + origin) in the config registry and prints the registration line.
- [x] `jarvis init` does not modify `v1/docs/operator-runbook.md`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that `jarvis init` now writes `OPERATOR_RUNBOOK.md` (previously it wrote no target files).
- Note the scaffolded runbook in `v1/docs/config.md` (the `jarvis init` section) and in the `init` CLI help.
