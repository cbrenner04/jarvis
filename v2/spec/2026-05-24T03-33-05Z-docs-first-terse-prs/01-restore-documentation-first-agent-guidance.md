# 01 - Restore documentation-first agent guidance

Jarvis tells implementation agents to inspect repo guidance and be terse, but it
does not make documentation-first behavior a hard part of the run prompt. That
let v2 implementation work proceed without first landing the reference docs/spec
contract that should have framed it.

Restore the directive in the shared prompt artifacts so implementation agents
treat relevant documentation as the first artifact to read and, when the change
affects documented behavior or architecture, the first artifact to update. This
builds on the standard and placement policy defined in
[00](./00-define-documentation-placement-and-inline-standard.md): ordering is
this subspec's concern, *what* counts as documentation and *where* it lives is
00's. Target the shared prompt surface so the rule binds both engines.

## Task checklist

- Identify the smallest shared prompt surface that reaches implementation agents
  without duplicating wording across prompt artifacts.
- Update the agent-facing guidance to require documentation-first behavior: read
  relevant durable docs before code, update the correct durable home (per 00's
  placement policy) in the same subspec when behavior or architecture changes,
  and do not defer doc alignment to a follow-up.
- Keep the directive terse and operational, not motivational prose, and
  consistent with the placement policy rather than restating it.
- Update prompt governance documentation and rendered-prompt snapshot coverage.

## Acceptance criteria

- [x] Rendered implementation prompts include an explicit documentation-first
      rule before the task-selection instruction.
- [x] The rule requires agents to read relevant durable docs before editing code
      and to update docs/specs in the same subspec when behavior, architecture,
      workflow, prompt, or operator-facing semantics change.
- [x] The rule routes updates to the home defined by 00's placement policy
      (inline vs `v2/docs/` vs spec) rather than duplicating the policy text.
- [x] The rule does not authorize speculative documentation churn for purely
      internal changes whose active subspec says no docs are required.
- [x] Prompt governance docs identify the documentation-first directive as an
      intentional shared prompt behavior and describe where it is owned.
- [x] Rendered prompt snapshot tests fail before the prompt update and pass after
      the new wording is accepted.
- [x] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

Update `v1/docs/prompt-governance.md` and any affected prompt-location or
run-loop docs so the shipped prompt contract describes documentation-first
behavior accurately and tersely. Cross-link 00's standard rather than restating
the placement rules.
