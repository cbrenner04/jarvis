Verdict: refine the spec on three points; two adversary findings are not upheld as blockers.

**1. Add `v2/docs/v1-behaviors.md` to Documentation updates.**
`repairIntentFile` is existing functionality gaining new heading-enforcement behavior. Spec guidance requires any spec changing existing functionality to record the new behavior in `v2/docs/v1-behaviors.md`. The current "Documentation updates" section only lists `prompts/intent/split.md`; add the v1-behaviors update alongside it.

**2. Add an acceptance criterion for the "no heading, no duplicate name: line" branch.**
The Decisions section describes three distinct cases: already-heading (untouched), duplicate `name:` line (replaced), and neither (prepend heading). Acceptance criteria currently only cover the first two. Add a third AC (and corresponding test coverage) for the prepend-when-absent case so all three decision branches are verified, not just asserted.

**3. Tighten the `name:\s*.*` match to avoid false positives.**
As written, the repair matches any first body line shaped like `name:\s*.*`, which could clobber legitimate prose that happens to start with "name:" (e.g., "name: value pairs are validated..."). Anchor the match to the actual slug value already known in `repairIntentFile` (e.g., match `name:\s*<the-repaired-slug>` or the literal duplicated frontmatter line) rather than the generic shape, so only the actual duplicated line is replaced.

Not required to change:
- The slug→title transform (e.g. `foo-bar` → `Foo Bar`) is a legitimate first-consumer precision gap but minor — the refiner may pin a simple deterministic transform (word-split on `-`, capitalize each word) directly in the Decisions section rather than leaving it unstated, but this does not need extensive design.
- Whether `v1/test/intent-command.sandbox-unrunnable.test.ts` runs under normal `bun run test` is a factual question about existing test infrastructure, not a spec defect — the file and its execution path already exist in the codebase; the spec references an existing test location and is not required to justify the sandbox-unrunnable naming convention.