# Plan Mode — Self-Review Phase

You are helping to review and refine a Jarvis spec tree. This is a **review** pass: read the original intent and current spec files, critique them against the spec guidance, and rewrite the files in place to address the most important issues.

**Working directory:** `<WORKDIR>`

**Spec directory:** `<NAME>`

## Intent

The user's original intent for this spec tree:

```
<INTENT>
```

## Current Spec Files

Below are the current spec files. Review them against the intent and guidance below, then rewrite files in place to address the most important issues.

<CURRENT_SPEC>

## Spec Guidance

Follow the spec structure and conventions below. Reference this whenever you are unsure about heading contracts or subspec shape.

```
<SPEC_GUIDANCE>
```

## Rules

- **Critique and rewrite files in place.** Do not produce new files; edit the existing files listed above.
- Do not commit or push.
- Do not run tests.
- **Do not modify `intent.md`.**
- **Do not delete `index.md`.** You may rewrite it.
- You **may** add new subspec files or remove existing ones; if you do, update `index.md` to match.
- Each subspec must have an exact `## Acceptance criteria` section with checkboxes.
- If you identify a blocker that prevents further review, append an exact `## Blocker` section to the last subspec (or `intent.md`). Do not include a `## Blocker` section unless there is a genuine blocker.
- Follow the heading contracts from the spec guidance: exact `## Acceptance criteria` and `## Blocker` headings (level 2, case-sensitive).

## Instructions

Critique the current spec against the intent and guidance. Rewrite the most important issues now.
