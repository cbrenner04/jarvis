# Index-only run routing

`jarvis run` should steer normal work through spec index files. Directly
running an implementation spec made it too easy for one agent invocation to
finish a whole checklist, bypassing the intended index-routed workflow.

## Subspecs

- [x] [00 — Runaway visibility and bounds](./00-runaway-visibility.md)
- [x] [01 — Index-only run validation](./01-index-only-run-validation.md)
- [x] [02 — External-agent spec guidance](./02-external-agent-spec-guidance.md)
- [x] [03 — Patch-mode rules](./03-patch-mode-rules.md)

## Conventions

- Run this spec with `jarvis run spec/index-only-run-routing/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
