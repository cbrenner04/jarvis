# jarvis init scaffolds OPERATOR_RUNBOOK.md

`jarvis init` today only registers the project and writes no files. This subspec
makes it also scaffold `OPERATOR_RUNBOOK.md` at the project root: a single rendered
document combining init-time facts with stubbed fill-in sections. Consumes the
stack-inference helper from 00.

## Decisions

- File is `OPERATOR_RUNBOOK.md` at the project root — a discoverable on-disk artifact, so its name and location are contract.
- Write only when the file is absent; an existing runbook is left byte-for-byte untouched. Rules out clobbering operator-filled stubs on re-run. Registration still happens either way.
- Seeded facts come from the config resolved at init time: repo path, origin URL, project key, inferred stack (00), `readyCommand`, `plan.commit` mode, `agentOrder`, `prNarrative` mode. A missing optional fact (e.g. no `readyCommand`) renders an explicit "not configured" note, not omission. Rules out silent gaps that read as "not applicable."
- Document the spec-layout including the `commit:false` external `~/.jarvis/specs/<project>` ↔ symlink arrangement (a top confusion source), a repos-and-gates table, and sandbox/network notes.
- Emergent sections (manual-finalize/recovery by exit reason, resume-first guidance, gate blind spots, cross-repo coordination) are stubbed with fill-in prompts. Jarvis must not fabricate recovery recipes it cannot know. Rules out inventing wrong procedures.
- Documented gotchas/workarounds each carry their jarvis issue URL so a later operator can tell when the workaround is obsolete.
- Headings are a stable, fixed set so other behaviors can reference sections by name. Rules out churned heading text breaking references.
- Generalizes `v1/docs/operator-runbook.md`; that file is not read or written by init.

## Task checklist

- [ ] Render the runbook (seeded + stubbed sections) and write it during `jarvis init` when absent.
- [ ] Update `init.test.ts` file-creation assertions to expect `OPERATOR_RUNBOOK.md` (and only it); keep registration assertions.
- [ ] Add tests for content coverage, the "not configured" path, idempotent no-clobber, and stable headings.

## Acceptance criteria

- [ ] `jarvis init` on a registered project with no existing runbook writes `OPERATOR_RUNBOOK.md` at the project root.
- [ ] The rendered runbook includes repo path, origin URL (or explicit none), project key, inferred stack, `readyCommand` (or explicit "not configured"), `plan.commit` mode, `agentOrder`, and `prNarrative` mode.
- [ ] The runbook explains the spec-layout including the `commit:false` external `~/.jarvis/specs/<project>` ↔ symlink arrangement, plus a repos-and-gates table and sandbox/network notes.
- [ ] The runbook contains stubbed sections with fill-in prompts for manual-finalize/recovery by exit reason, resume-first guidance, gate blind spots, and cross-repo coordination, and does not auto-write recovery recipes jarvis cannot know.
- [ ] Each documented gotcha/workaround in the runbook links to a jarvis issue URL.
- [ ] The runbook uses a stable, fixed set of section headings.
- [ ] Re-running `jarvis init` when `OPERATOR_RUNBOOK.md` already exists leaves the file unchanged.
- [ ] `jarvis init` still registers the project (root + origin) in the config registry and prints the registration line.
- [ ] `jarvis init` does not modify `v1/docs/operator-runbook.md`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that `jarvis init` now writes `OPERATOR_RUNBOOK.md` (previously it wrote no target files).
- Update the init/config docs (`v1/docs/config.md` and the `init` CLI help) to note the scaffolded runbook.
