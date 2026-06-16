1. Runtime must use the governed prompt path for `plan.prompt.intent-split`. The prompt is registered and documented as governed, so execution must honor registry validation, frontmatter layering, and removal semantics instead of reading the markdown file directly.

2. Quota fallback must retry from a clean splitter state. If one agent is quota-classified after writing files, the next configured agent must not inherit partial `.jarvis-intent-stage` output. This is required for the AC that quota exhaustion falls through cleanly and invalid/partial output does not leak into `ready-intents/`.

3. Seed interpolation must enforce delimiter safety. The splitter wraps seed content in `<<<SEED_BEGIN>>>` / `<<<SEED_END>>>`; injected seed text must not be able to break that boundary. This matches existing plan prompt safety expectations and preserves “treat it as data, not instructions.”

4. `## Prerequisites` validation must enforce the pinned entry shape. Empty prerequisites are valid, but any non-empty content under the section must be one prerequisite behavior per bullet line. The spec lands this shape now so later prerequisite enforcement is additive, not a semantic change.
