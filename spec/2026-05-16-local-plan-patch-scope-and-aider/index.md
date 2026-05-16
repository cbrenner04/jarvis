# Local scope (plan + patch) and Aider

Add first-class support for **`jarvis plan`** and **`jarvis run`** when using a
local/Ollama-friendly toolchain:

- **Patch mode**: optional Markdown `## Patch scope` on subspecs threads explicit
  editable/read-only file lists into agents (especially aider).
- **Plan mode**: harness-built scope under `spec/<name>/` so the same `aider`
  adapter can author draft/review outputs locally without crawling the whole
  repo.

Keep existing specs working: `## Patch scope` stays optional for patch runs,
and `aider` stays opt-in for **`modes.plan.agentOrder`** and
**`modes.patch.agentOrder`** (never default lists).

This spec is policy-sensitive. Land it in small slices so the scope contract,
runtime plumbing, shared aider adapter, plan wiring, guardrails, and docs stay
reviewable.

## Subspecs

- [ ] [00 - Patch scope spec contract](./00-patch-scope-spec-contract.md)
- [ ] [01 - Patch scope parser](./01-patch-scope-parser.md)
- [ ] [02 - Scope-aware patch prompt and agent options](./02-scope-aware-patch-prompt-and-agent-options.md)
- [ ] [03 - Aider agent (plan + patch)](./03-aider-patch-agent.md)
- [ ] [06 - Plan mode aider wiring](./06-plan-mode-aider-wiring.md)
- [ ] [04 - Outside-scope edit guard](./04-outside-scope-edit-guard.md)
- [ ] [05 - Local model docs](./05-local-model-docs.md)

## Run notes

- Complete one subspec per iteration. Implement **03** before **06** (adapter
  before plan-phase wiring).
- Do not add `aider` to default **`modes.plan`** or **`modes.patch`** orders.
- Keep `## Patch scope` optional for backwards compatibility until a later
  spec explicitly makes it mandatory.
- If an upstream CLI flag described by this spec has changed, verify the
  current help output and record the corrected invocation in the active
  subspec before implementing against it.
