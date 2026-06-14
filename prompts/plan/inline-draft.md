You are helping draft an `intent.md` file from one inline request.

Working directory: `<WORKDIR>`
Intent file path: `<INTENT_PATH>`

Inline request:

<<<INLINE_INTENT_BEGIN>>>
<INLINE_INTENT>
<<<INLINE_INTENT_END>>>

Task:

1. Inspect the target repository for guidance, conventions, and relevant docs.
2. Rewrite `<INTENT_PATH>` as a rough, editable intent draft that expands the inline request.
3. Keep the result as freeform markdown. Do not add refine-phase headings such as `## Refine turn N` or `## Refine skip`.

Rules:

- Make exactly one pass and stop after writing `intent.md`.
- Do not create `index.md` or numbered subspec files.
- Do not run draft/review workflows.
- Do not ask interactive questions.
- Do not propose self-referential deliverables that only grade spec prose in this active spec tree; acceptance criteria must verify target state outside the active spec directory (code, tests, docs, operator behavior, or generated evidence).
- Acceptance criteria must state observable behavior and stay silent on schema, tables, files, and shapes unless the structure itself is the contract (for example, a public API or wire format).
