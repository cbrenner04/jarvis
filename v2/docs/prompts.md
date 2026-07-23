# Prompt registry

Registered prompt artifacts live under `prompts/` and are listed in
`prompts/registry.txt`. Each artifact carries YAML frontmatter (`id`, `behavior`,
`kind`, `revision`, `placeholders`) and a Markdown body.

## Write-step prompts

| Id | File | Role |
| --- | --- | --- |
| `write.execute` | `prompts/write/execute.md` | Default standalone write step |
| `write.token-reprompt` | `prompts/write/token-reprompt.md` | Token-only re-prompt after a token-less response |
| `write.blocker-reprompt` | `prompts/write/blocker-reprompt.md` | Re-prompt when `blocked` misses blocker text |
| `write.ready-repair` | `prompts/write/ready-repair.md` | Ready-gate repair iteration |
| `write.coverage-advisory` | `prompts/write/coverage-advisory.md` | Deliver-only uncovered-changed-line advisory before implement completion boundary |
