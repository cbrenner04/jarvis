# Local Patch Scope and Aider

Add first-class support for scoped patch-mode specs and an opt-in `aider`
agent suitable for local Ollama models. The goal is to make Jarvis patch runs
more predictable for smaller/local models without making existing specs fail
or forcing every agent through aider-specific behavior.

This spec is policy-sensitive. Land it in small slices so the scope contract,
runtime plumbing, aider adapter, and guardrails can be reviewed separately.

## Subspecs

- [ ] [00 - Patch scope spec contract](./00-patch-scope-spec-contract.md)
- [ ] [01 - Patch scope parser](./01-patch-scope-parser.md)
- [ ] [02 - Scope-aware patch prompt and agent options](./02-scope-aware-patch-prompt-and-agent-options.md)
- [ ] [03 - Aider patch agent](./03-aider-patch-agent.md)
- [ ] [04 - Outside-scope edit guard](./04-outside-scope-edit-guard.md)
- [ ] [05 - Local model docs](./05-local-model-docs.md)

## Run notes

- Complete one subspec per iteration.
- Do not make `aider` part of the default agent order.
- Keep `## Patch scope` optional for backwards compatibility until a later
  spec explicitly makes it mandatory.
- If an upstream CLI flag described by this spec has changed, verify the
  current help output and record the corrected invocation in the active
  subspec before implementing against it.
