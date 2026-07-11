#!/usr/bin/env python3

with open('v2/docs/workflow-runner.md', 'r') as f:
    lines = f.readlines()

# Find and update the lines
new_lines = []
i = 0
while i < len(lines):
    if i == 185 and 'validates a named preset\'s fixed step count' in lines[i]:
        # Replace this and the next few lines
        new_lines.append('`resolveWorkflowPreset(name, steps)` validates a named preset\'s step count\n')
        i += 1
        # Skip to the "For implement" part
        while i < len(lines) and 'For `implement`' not in lines[i]:
            new_lines.append(lines[i])
            i += 1
        # Now update the "For implement" part
        if 'For `implement`, the caller\'s `role`/`promptId` on that step are discarded' in lines[i]:
            new_lines.append('For `implement`, the caller\'s `role`/`promptId` on each step are discarded: the\n')
            i += 1
            new_lines.append('preset pins `role: "implement"` and `promptId: "patch.prompt.body"`\n')
            i += 1
            new_lines.append('unconditionally on all positions.\n')
            i += 1
            # Skip the old line about discarding
            if 'unconditionally' in lines[i]:
                i += 1
    elif 'Current preset surface:' in lines[i]:
        new_lines.append(lines[i])
        i += 1
        # Find and update the implement line
        while i < len(lines) and '- `write-write`' in lines[i]:
            new_lines.append(lines[i])
            i += 1
        if '- `implement`:' in lines[i]:
            new_lines.append('- `implement`: one or two steps, with `role`/`promptId` fixed by the preset on both positions\n')
            i += 1
            # Skip the old implement description
            while i < len(lines) and '- `intent`' not in lines[i]:
                i += 1
        else:
            new_lines.append(lines[i])
            i += 1
    else:
        new_lines.append(lines[i])
        i += 1

with open('v2/docs/workflow-runner.md', 'w') as f:
    f.writelines(new_lines)

print("File updated")
