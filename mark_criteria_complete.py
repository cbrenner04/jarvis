#!/usr/bin/env python3

with open('v2/spec/2026-07-11T14-14-51Z-implement-preset-optional-review-slot/00-implement-preset-second-step.md', 'r') as f:
    content = f.read()

# Mark all acceptance criteria as complete
replacements = [
    ('- [ ] `resolveWorkflowPreset("implement", ...)`', '- [x] `resolveWorkflowPreset("implement", ...)`'),
    ('- [ ] Workflow preset tests cover', '- [x] Workflow preset tests cover'),
    ('- [ ] `v2/docs/workflow-runner.md` documents', '- [x] `v2/docs/workflow-runner.md` documents'),
]

for old, new in replacements:
    content = content.replace(old, new)

with open('v2/spec/2026-07-11T14-14-51Z-implement-preset-optional-review-slot/00-implement-preset-second-step.md', 'w') as f:
    f.write(content)

print("Acceptance criteria marked as complete")
