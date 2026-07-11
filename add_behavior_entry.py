#!/usr/bin/env python3

with open('v2/docs/v1-behaviors.md', 'r') as f:
    lines = f.readlines()

# Find the line with the workflow preset description
for i, line in enumerate(lines):
    if 'v2/src/execution/plan-workflow-steps.ts' in line and '`v2/docs/workflow-runner.md`' in line:
        # Insert a new line after this one
        new_entry = '\n- **[v2 additive]** Implement preset accepts one or two authored write steps; other resolver-supported presets (`write-write`, `intent`, `plan`) retain their exact cardinalities. Each accepted implement step is pinned to `behavior: "write"`, `role: "implement"`, and `promptId: "patch.prompt.body"`, mirroring the single-step preset\'s field pinning. The two-step form permits a future optional review slot while keeping implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`\n'
        lines.insert(i + 1, new_entry)
        break

with open('v2/docs/v1-behaviors.md', 'w') as f:
    f.writelines(lines)

print("Entry added successfully")
