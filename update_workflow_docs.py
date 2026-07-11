#!/usr/bin/env python3

# Read the file
with open('v2/docs/workflow-runner.md', 'r') as f:
    content = f.read()

# Update the description of resolveWorkflowPreset
old_description = '''`resolveWorkflowPreset(name, steps)` validates a named preset's fixed step count
and returns a `WorkflowStep[]`. Callers supply `stepId`, `role`, and the rest of
the per-step write-loop content for each position, omitting `behavior` (the
preset supplies `"write"` per position until the runner dispatches on behavior).
For `implement`, the caller's `role`/`promptId` on that step are discarded: the
preset pins `role: "implement"` and `promptId: "patch.prompt.body"`
unconditionally.'''

new_description = '''`resolveWorkflowPreset(name, steps)` validates a named preset's step count
and returns a `WorkflowStep[]`. Callers supply `stepId`, `role`, and the rest of
the per-step write-loop content for each position, omitting `behavior` (the
preset supplies `"write"` per position until the runner dispatches on behavior).
For `implement`, the caller's `role`/`promptId` on each step are discarded: the
preset pins `role: "implement"` and `promptId: "patch.prompt.body"`
unconditionally on all positions.'''

content = content.replace(old_description, new_description)

# Update the preset surface list
old_surface = '''Current preset surface:

- `write-write`: two steps
- `implement`: one step, with `role`/`promptId` fixed by the preset
- `intent`: one step (split only)
- `intent-reviewed`: two steps (split + review)
- `plan`: one step, with `role`/`promptId` fixed by the preset'''

new_surface = '''Current preset surface:

- `write-write`: two steps
- `implement`: one or two steps, with `role`/`promptId` fixed by the preset on both positions
- `intent`: one step (split only)
- `intent-reviewed`: two steps (split + review)
- `plan`: one step, with `role`/`promptId` fixed by the preset'''

content = content.replace(old_surface, new_surface)

# Write the file back
with open('v2/docs/workflow-runner.md', 'w') as f:
    f.write(content)

print("workflow-runner.md updated successfully")
