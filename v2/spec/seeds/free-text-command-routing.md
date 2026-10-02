---
name: free-text-command-routing
---

# Route one-shot free-text requests to supported Jarvis commands

## Problem

The operator should be able to write `jarvis "create a pipeline for v2/spec/path/to/seed.md"` without remembering command grammar. This is one command invocation, not a conversation, coding session, or autonomous workflow planner.

## Decisions

- Invoke a cheap agent to translate the request into one supported high-level action and typed arguments. Model selection remains configurable; this feature does not require a new model-ranking system.
- Give the routing agent no execution tools, repository browsing, or inherited coding-agent tool permissions. Supply only the action catalog and the minimal explicit context needed for translation.
- Treat model output as untrusted input. Validate against a closed action catalog and strict argument schemas before dispatch. Reject unknown actions, extra fields, arbitrary command strings, and executable payloads.
- Dispatch through the same canonical command/service operations used by the explicit CLI. Free text selects high-level operations; it does not invoke low-level Git or file tools, generate shell commands, or duplicate workflow admission logic.
- Resolve projects, paths, IDs, permissions, and current-state preconditions deterministically. The model cannot invent configuration overrides, bypass approval gates, or supply arbitrary pipeline definitions.
- Ambiguous, unsupported, incomplete, or invalid requests return an error and perform no action. No clarification session, guessed meaning, automatic recovery sequence, or multi-action execution. In particular, do not invent a `restart` alias for `resume`.
- Preserve explicit command behavior. Malformed explicit commands remain errors rather than silently becoming model requests. Decide the free-text entry grammar and collision handling during planning.
- Support the quoted form. Consider joining unquoted arguments for ordinary sentences where command routing is unambiguous; document that shell expansion and punctuation are processed before Jarvis receives them.
- Bound routing time and output. Failure to produce a valid action performs no operation. Return the operation's actual result without a second model interpretation.
- Start with a deliberately small action catalog and grow it from operator usage. Sharing implementations with CLI commands or coding-agent tools does not grant the router their full authority.

## Prerequisites

- [Centralize deterministic operations](./centralize-deterministic-operations.md) establishes the ownership rules; reuse canonical lifecycle/admission services for the initial catalog. Routing need not wait for the complete coding-agent toolset, but its own invocation must have tools disabled.

## Open questions

- Initial supported actions and their exact required arguments.
- Cheap agent/model binding and how its tool-free invocation is enforced for the selected vendor.
- Quoted top-level requests, optional unquoted requests, and an explicit entry form for collisions with existing command names.
- Minimal routing context, execution audit records, and duplicate-request handling after a transport failure.

## Acceptance criteria

- [ ] A supported pipeline-start sentence reaches the same admission service and produces the same result as the explicit command.
- [ ] Tests cover valid routing, ambiguity, missing/invalid targets, unsupported actions, schema violations, attempted tool execution, and model failure; rejected requests cause no mutation.
- [ ] Existing explicit command parsing remains deterministic and does not fall through to the model on errors.
- [ ] The router's launch configuration exposes no execution tools; execution rechecks the operation's admission rules.
- [ ] Implementation specs name typecheck and the additive test scopes required by their actual changed surfaces.

## Documentation updates

- `v2/docs/operator-runbook.md` — invocation syntax, supported actions, ambiguity errors, and shell quoting limitations.
- `v2/docs/agent-model-config.md` — routing model selection and its tool-free invocation contract.
- `v2/docs/v2-architecture.md` — translation, validation, and dispatch boundaries.
