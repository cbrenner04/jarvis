#!/usr/bin/env python3

with open('v2/docs/v1-behaviors.md', 'r') as f:
    content = f.read()

# Remove all the duplicate entries first
search = '- **[v2 additive]** Implement preset accepts one or two authored write steps; other resolver-supported presets (`write-write`, `intent`, `plan`) retain their exact cardinalities. Each accepted implement step is pinned to `behavior: "write"`, `role: "implement"`, and `promptId: "patch.prompt.body"`, mirroring the single-step preset\'s field pinning. The two-step form permits a future optional review slot while keeping implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`'

# Count occurrences
count = content.count(search)
print(f"Found {count} occurrences")

# Keep only the first one by removing from position after 237
lines = content.split('\n')
new_lines = []
found_first = False
for i, line in enumerate(lines):
    if 'Implement preset accepts one or two' in line:
        if not found_first:
            new_lines.append(line)
            found_first = True
        # Skip duplicates
    else:
        new_lines.append(line)

with open('v2/docs/v1-behaviors.md', 'w') as f:
    f.write('\n'.join(new_lines))

print("Fixed duplicates")
