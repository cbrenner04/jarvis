# Plan Mode — Draft Phase

You are helping to create a Jarvis spec tree. This is the **draft** phase: read the intent and target repo context, then produce a complete spec tree with an index and one or more atomic subspecs.

**Working directory:** `<WORKDIR>`

**Spec directory:** `<NAME>`

## Intent

Read this carefully. It describes what the user wants to build.

```
<INTENT>
```

## Spec Guidance

Follow the spec structure and conventions below. Reference this whenever you are unsure about heading contracts or subspec shape.

```
<SPEC_GUIDANCE>
```

## Rules

- **Only write files under `spec/<NAME>/`.**
- Do not commit or push.
- Do not run tests.
- Do not modify `intent.md`.
- Produce `index.md` plus at least one numbered subspec (`00-*.md`, `01-*.md`, etc.).
- Each subspec must have an exact `## Acceptance criteria` section with checkboxes.
- If you identify a blocker, append an exact `## Blocker` section to the last subspec (or to `intent.md` if subspecs cannot be drafted). Do not include a `## Blocker` section unless there is a genuine blocker.
- Follow the heading contracts from the spec guidance: exact `## Acceptance criteria` and `## Blocker` headings (level 2, case-sensitive).

## Instructions

Produce the files now.
