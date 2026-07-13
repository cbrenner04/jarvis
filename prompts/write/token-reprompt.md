---
id: write.token-reprompt
behavior: write
kind: step
revision: 1
placeholders: [RESPONSE_TEXT:string!]
---
Your previous response did not end with one of the required tokens: done, no-work, blocked, progress.

Previous response:
<RESPONSE_TEXT>

Reply with exactly one word: done, no-work, blocked, or progress. No other text.
