- Split the oversized subspec into independently testable publisher, intent, direct-write/spec, and plan slices; link each from `index.md`, and carry every original scope item and acceptance outcome exactly once.

- Preserve the workflow-derived title through completed-run retry, including intent and reviewed-intent publication; retry must not silently fall back because its original subject is no longer available.

- Define the intent seed-name source for inline seeds, file seeds, and conflicting candidate names, and cover reviewed-intent landing.

- Define direct-write behavior when `specPath` is not `index.md`: resolve the sibling index title or use the fallback.

- Define an unresolvable index title as missing, unreadable, malformed, blank, or whitespace-only; v2 must use the fixed fallback rather than v1-style basename substitution.

- Require existing-title preservation for every reused open PR, including ready PRs, since the publisher reuses all open PRs.

- Require focused automated coverage for workflow-runner publication, durable retry, reviewed intent, non-index write, fallback, and reuse of draft and ready PRs.

- Keep the required durable documentation aligned with the finalized behavior; these are operator-facing completion semantics and v2 parity behavior.
