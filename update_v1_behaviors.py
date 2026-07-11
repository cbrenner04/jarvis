#!/usr/bin/env python3

# Read the file
with open('v2/docs/v1-behaviors.md', 'r') as f:
    content = f.read()

# Find the section about workflow presets and add the new entry
old_section = '''### v2 additive: named workflow presets

- `jarvis run workflow <name> [flags]` selects a CLI builder by name; `implement`, `intent`, `intent-reviewed`, and `plan` are registered. Missing or unknown names print `usage: jarvis run workflow <implement|intent|intent-reviewed|plan> [flags]` and exit `1` before daemon connection. The `implement` launch preserves its `--branch`, `--base`, `--spec`, and `--artifact` parser; `intent`/`intent-reviewed` use `(--seed <path> | --seed-text <text>) [--target-dir <dir>]`; `plan` uses `--ready-intent <path> [--target-dir <dir>]`. All builders validate their inputs and exit `1` pre-daemon before bad state reaches the daemon. Sources: `v2/src/cli.ts`, `v2/src/execution/plan-workflow-steps.ts`, `v2/docs/workflow-runner.md`

### v2 machine config CLI (`jarvis config`)'''

new_section = '''### v2 additive: named workflow presets

- `jarvis run workflow <name> [flags]` selects a CLI builder by name; `implement`, `intent`, `intent-reviewed`, and `plan` are registered. Missing or unknown names print `usage: jarvis run workflow <implement|intent|intent-reviewed|plan> [flags]` and exit `1` before daemon connection. The `implement` launch preserves its `--branch`, `--base`, `--spec`, and `--artifact` parser; `intent`/`intent-reviewed` use `(--seed <path> | --seed-text <text>) [--target-dir <dir>]`; `plan` uses `--ready-intent <path> [--target-dir <dir>]`. All builders validate their inputs and exit `1` pre-daemon before bad state reaches the daemon. Sources: `v2/src/cli.ts`, `v2/src/execution/plan-workflow-steps.ts`, `v2/docs/workflow-runner.md`

- **[v2 additive]** Implement preset accepts one or two authored write steps; other resolver-supported presets (`write-write`, `intent`, `plan`) retain their exact cardinalities. Each accepted implement step is pinned to `behavior: "write"`, `role: "implement"`, and `promptId: "patch.prompt.body"`, mirroring the single-step preset's field pinning. The two-step form permits a future optional review slot while keeping implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`

### v2 machine config CLI (`jarvis config`)'''

content = content.replace(old_section, new_section)

# Write the file back
with open('v2/docs/v1-behaviors.md', 'w') as f:
    f.write(content)

print("v1-behaviors.md updated successfully")
