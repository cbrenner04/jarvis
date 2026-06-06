---
id: prompt.rules
behavior: prompt
kind: fragment
revision: 1
---
# Prompt Mode

One-shot agent invocation for a prompt-only request.

## Scope and limits
- Do not run `git commit`, `git push`, or `gh pr create` — the harness handles all git and GitHub operations.
- All other behaviors are at the harness operator's discretion.

## Stop
- No mandatory stopping conditions; all output contributes to the final response.
