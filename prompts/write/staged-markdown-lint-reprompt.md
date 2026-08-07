---
id: write.staged-markdown-lint-reprompt
behavior: write
kind: step
revision: 1
placeholders: [RULE_ID:string!, OFFENDING_FILE:string!, STAGING_DIR:string!, VIOLATION:string!]
---
Your staged plan Markdown violates markdownlint.

Rule: <RULE_ID>

Violation: <VIOLATION>

Fix the file: <OFFENDING_FILE>

Edit only markdown files under `<STAGING_DIR>` to fix the violation. Return exactly one terminal token when done.
