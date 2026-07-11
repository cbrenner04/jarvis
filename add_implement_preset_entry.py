#!/usr/bin/env python3

with open('v2/docs/v1-behaviors.md', 'r') as f:
    lines = f.readlines()

# Find the line with v2/docs/workflow-runner.md in workflow presets section
for i, line in enumerate(lines):
    if 'v2/docs/workflow-runner.md' in line and 'workflow' in line and i < 250:
        # Check if this is in the workflow presets section
        if any('jarvis run workflow' in lines[j] for j in range(max(0, i-5), i)):
            # Insert after this line (add a blank line first, then the new entry)
            new_entry = '''
- **[v2 additive]** Implement preset accepts one or two authored write steps; other resolver-supported presets (`write-write`, `intent`, `plan`) retain their exact cardinalities. Each accepted implement step is pinned to `behavior: "write"`, `role: "implement"`, and `promptId: "patch.prompt.body"`, mirroring the single-step preset's field pinning. The two-step form permits a future optional review slot while keeping implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`
'''
            lines.insert(i + 1, new_entry)
            break

with open('v2/docs/v1-behaviors.md', 'w') as f:
    f.writelines(lines)

print("Entry added successfully")
