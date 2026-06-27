---
name: init-scaffolds-operator-runbook
---

# `jarvis init` scaffolds an OPERATOR_RUNBOOK.md

`jarvis init` writes an `OPERATOR_RUNBOOK.md` for the registered project so operator
knowledge is a first-class artifact instead of a blank page each new project. Generalizes
the mature hand-built `v1/docs/operator-runbook.md`; does not touch that file.

Two content kinds in one rendered document:

- **Seeded from init-time facts:** repo path/origin URL/project key, inferred stack,
  resolved `readyCommand`, `plan.commit` mode, `agentOrder`, `prNarrative` mode; the
  spec-layout explanation (esp. the `commit:false` external `~/.jarvis/specs/<proj>` ↔
  symlink arrangement — a top confusion source); a repos-and-gates table; sandbox/network
  notes.
- **Stubbed emergent sections** with fill-in prompts (jarvis can't know these at init):
  manual-finalize/recovery recipes keyed by exit reason; resume-first guidance (`run`
  again / `--resume-review` / `triage --mark-ready`) vs hand-finalize; gate blind spots
  (what `readyCommand` can't verify — render timing, fixed/portal geometry, animation);
  cross-repo coordination.

Documented gotchas/workarounds link to their jarvis issue URL so a later operator can tell
when a workaround is obsolete. Sections carry stable names so other behaviors can reference
them. Don't auto-write recovery recipes jarvis can't know — stub them.

Intake #598.

## Prerequisites
- `jarvis init` registers a target project (root + origin) in the config registry
