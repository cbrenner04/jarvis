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
