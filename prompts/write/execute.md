---
id: write.execute
description: agent-facing
behavior: agent-facing
kind: template
revision: 1
placeholders: [TASK:string!]
---
Complete exactly this write step:
<TASK>

Return exactly one terminal token as the first line: done, no-work, blocked, or progress.
