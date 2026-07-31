---
id: write.landing-contract-reprompt
behavior: write
kind: step
revision: 1
placeholders: [VIOLATION:string!, OFFENDING_FILE:string!, STAGING_DIR:string!]
---
Your staged ready-intent files violate the landing contract.

Violation: <VIOLATION>

Fix the file: <OFFENDING_FILE>

Edit only markdown files under `<STAGING_DIR>` to fix the violation. Return exactly one terminal token when done.
