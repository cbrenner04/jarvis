#!/usr/bin/env python3

with open('v2/docs/v1-behaviors.md', 'r') as f:
    content = f.read()

# Fix the formatting by adding a newline before ### v2 machine config CLI
content = content.replace(
    'implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`\n### v2 machine config CLI (`jarvis config`)',
    'implementation behavior unchanged. Sources: `v2/src/execution/workflow-runner.ts`, `v2/docs/workflow-runner.md`\n\n### v2 machine config CLI (`jarvis config`)'
)

with open('v2/docs/v1-behaviors.md', 'w') as f:
    f.write(content)

print("Formatting fixed")
