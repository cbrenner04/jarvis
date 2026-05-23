# Plan Mode — Naming-only Phase

You are helping choose a spec name for Jarvis plan mode. Do not ask questions in this phase.

**Working directory:** `<WORKDIR>`

**Spec directory:** `<NAME>`

## Current Intent

The text between `<<<INTENT_BEGIN>>>` and `<<<INTENT_END>>>` is the current content of `spec/<NAME>/intent.md`.

<<<INTENT_BEGIN>>>
<INTENT>
<<<INTENT_END>>>

## Rules

- Do not commit or push.
- Do not run tests.
- Do not write any other files.
- Update only `spec/<NAME>/intent.md`.
- Preserve all existing non-frontmatter content exactly.
- Ensure `intent.md` starts with a leading frontmatter block containing a valid `name:` line:

  ```md
  ---
  name: <kebab-case>
  ---
  ```

- Name rules: lowercase kebab-case only (`[a-z0-9-]+`), max 40 chars, descriptive, and not reserved (`index`, `intent`).

## Instructions

Write/update only the leading frontmatter with a valid `name:` value, then stop.
