#!/usr/bin/env python3

with open('v2/docs/v1-behaviors.md', 'r') as f:
    content = f.read()

# Find the exact position after "v2/docs/workflow-runner.md" in the workflow presets section
pos = content.find('v2/src/execution/plan-workflow-steps.ts`, `v2/docs/workflow-runner.md`')
if pos != -1:
    # Find the end of that line
    end_of_line = content.find('\n', pos)
    if end_of_line != -1:
        # Insert our new entry after this line
        insert_pos = end_of_line + 1
        new_entry = '''
- **[v2 additive]** Implement preset accepts one or two authored write steps; other resolver-supported presets (`write-write`, `intent`, `plan`) retain their exact cardinalities. Each accepted implement step is pinned to `behavior: "write"`, `role: "implement"`, and `promptId: "patch.prompt.body"`, mirroring the single-step preset's field pinning. The two-step form permits a future optional review slot while keeping implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`'''
        content = content[:insert_pos] + new_entry + content[insert_pos:]
        with open('v2/docs/v1-behaviors.md', 'w') as f:
            f.write(content)
        print("Inserted successfully")
    else:
        print("Could not find end of line")
else:
    print("Could not find search position")
