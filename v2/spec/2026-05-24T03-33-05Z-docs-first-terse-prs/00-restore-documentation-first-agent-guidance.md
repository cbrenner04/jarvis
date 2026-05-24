# 00 - Restore documentation-first agent guidance

Jarvis currently tells patch agents to inspect repo guidance and be terse, but it
does not make documentation-first behavior a hard part of the run prompt. That
allowed v2 implementation work to proceed without first landing the reference
docs/spec contract that should have framed the work.

Restore the directive in the shared prompt artifacts so implementation agents
must treat relevant documentation as the first artifact to inspect and, when the
change affects documented behavior or architecture, the first artifact to update.

## Task checklist

- Identify the smallest prompt surface that reaches patch-mode implementation
  agents without duplicating wording across prompt artifacts.
- Update the agent-facing guidance to require documentation-first behavior:
  read relevant docs before code, update durable docs/specs before or with code,
  and do not leave doc alignment to a follow-up when behavior or architecture
  changes.
- Keep the directive terse and operational, not motivational prose.
- Update prompt governance documentation and rendered-prompt snapshot coverage.

## Acceptance criteria

- [ ] Patch-mode rendered prompts include an explicit documentation-first rule
      before the task-selection instruction.
- [ ] The rule requires agents to read relevant long-lived docs before editing
      code and to update docs/specs in the same subspec when behavior,
      architecture, workflow, prompt, or operator-facing semantics change.
- [ ] The rule does not authorize speculative documentation churn for purely
      internal changes whose active subspec says no docs are required.
- [ ] Prompt governance docs identify the documentation-first directive as an
      intentional shared prompt behavior and describe where it is owned.
- [ ] Rendered prompt snapshot tests fail before the prompt update and pass after
      the new wording is accepted.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

Update `v1/docs/prompt-governance.md` and any affected prompt-location or
run-loop docs so the shipped prompt contract describes documentation-first
behavior accurately and tersely.

