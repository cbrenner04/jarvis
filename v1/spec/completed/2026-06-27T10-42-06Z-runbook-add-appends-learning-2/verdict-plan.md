## Verdict

The following refinements are required before the spec is ready to implement.

**1. Pin the rendered entry format.**
The spec does not define the bullet prefix, link anchor text, or placement of `--issue-url` within the appended item. Two implementers will produce different output. The spec must state the exact format (e.g., `- <entry>` or `- <entry> ([#N](<url>))`) so both the implementation and tests have a single target. Required: one Decisions entry plus a matching AC.

**2. Restrict `--section` to list-safe stable headings.**
Several scaffold sections (the repos/gates table, project-facts key-value block, spec-layout mixed prose) do not contain flat bullet lists. Appending a list item to them produces malformed content. The spec must either enumerate the valid `--section` targets as the flat-list-containing subset, or define an exit-1 behavior for incompatible sections. The `## Known gotchas` default is already in the safe subset, so restricting the valid set is the natural call. This also makes the sub-section-boundary rule safe: "before the next `## ` heading" is unambiguous within list sections.

**3. Name the authoritative heading source.**
The spec says `--section` validates against "the scaffold's stable headings" but does not name where that set is defined. The refiner should cite `runbook-generator.ts` (or wherever the stable heading set lives) explicitly in the Decisions block so the implementer has a single source of truth and tests can enumerate it without guessing.

**4. Define bare `jarvis runbook` and unknown-action behavior.**
The spec covers `runbook add` but leaves `jarvis runbook` (no action) and `jarvis runbook <unknown>` undefined. The AC block must state what happens in both cases (show usage / exit 1 consistent with other subcommands). Required: one AC covering both.

**5. Clarify whitespace-only entry text.**
The spec exits 1 on missing entry text but is silent on `jarvis runbook add "   "`. The spec must state that whitespace-only input is treated as missing and exits 1 with usage — consistent with how `prompt` handles it.

**6. Add a one-line decision on `--issue-url` value validation.**
The spec is silent on whether the URL value is validated. A decision stating "any non-empty string is accepted; no format validation" is sufficient. The empty-string case should produce the same exit-1-with-usage behavior as missing entry text, or be explicitly distinguished.

**7. Tighten task checklist item 3.**
"Cover the behaviors below with tests" is ambiguous. Rephrase to "Write unit tests covering each acceptance criterion." This is a minor wording change but removes a genuine source of implementer confusion about scope.