Changes required:

- Align durable docs: remove retired plan-splitting claims from `spec-guidance-agent-core.md` and `workflow-runner.md`; document artifact-count validation in `write-behavior.md`. Intent-stage splitting remains valid.
- Enforce root-level artifacts such as `package.json` and `README.md`; the current slash-required matcher lets multi-artifact bullets bypass validation.
- Validate every governed section occurrence. Duplicate `## Acceptance criteria`, `## Decisions`, or `## Documentation updates` sections currently bypass checks after the first.
