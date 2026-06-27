## Verdict

**Subspec 00 — Infer project stack**

1. **Marker→label set must be enumerated.** The decisions reference a "small, explicit marker→label set" with examples but leave the full set open. Subspec 01 is the immediate consumer and constrains runbook content; "deferred to first consumer" does not apply. The spec must list the complete marker→label table (not examples).

2. **Precedence rule must be defined.** Both the decisions and the only AC covering polyglot roots reference "documented precedence" without stating the rule or where it is documented. An implementer cannot implement or verify this without it. The spec must state the tie-break rule (e.g., ordered priority list) inline.

3. **AC wording for named ecosystems is ambiguous.** The AC uses "(e.g.)" before naming Ruby and Go, making it unclear whether those are required or illustrative. Drop the hedge; name the required ecosystems directly.

---

**Subspec 01 — Scaffold OPERATOR_RUNBOOK.md**

4. **Section headings must be enumerated.** The decision asserts headings are a "stable, fixed set so other behaviors can reference sections by name" — this is the entire rationale for the stability claim. Without listing the heading text, an implementer invents them and the AC "uses a stable, fixed set of section headings" is unverifiable. The spec must enumerate the heading set.

5. **`agentOrder` and `prNarrative` must specify which config modes are seeded.** Both fields exist on multiple modes (`modes.patch`, `modes.plan`, `modes.review`, etc.). The spec must name which mode(s) are rendered in the runbook; otherwise runbook content is indeterminate.

6. **Repos-and-gates table needs a schema.** The AC says "contains a repos-and-gates table" but names no columns or data source. Without a minimum schema (e.g., what rows and columns), the AC is unverifiable. The spec must specify what the table contains.

7. **Sandbox/network notes section has no content spec or AC coverage.** The intent lists sandbox/network notes as a seeded section, but neither the decisions nor the ACs say what those notes contain or how they vary per project. Either specify the content or explicitly scope it out.

8. **Gotcha/workaround list must be enumerated (or pointed to an authoritative source).** The AC requires each gotcha to link to a jarvis issue URL, but the spec names no gotchas. `jarvis init` cannot discover them from the project — they must be baked into the template. Without an enumerated list, the AC is unverifiable. The spec must name the gotchas (or reference the file/list that is the authoritative source).

9. **Idempotency language must match between decision and AC.** The decision says "byte-for-byte untouched"; the AC says "leaves the file unchanged." Align to identical language so the AC enforces the decision's actual constraint.

10. **"Or explicit none" for origin URL needs concrete rendering.** The AC says "origin URL (or explicit none)" without specifying what the rendered note looks like. Tighten to name the expected output (e.g., "an explicit 'no origin configured' note").

---

**Minor (address opportunistically)**

- Task checklist item "and only it" encodes a fragile test-internal constraint; the behavioral intent (init must not write unexpected files) belongs in an AC, not test guidance.
- `v1/docs/config.md` documentation update should name the target section (e.g., `## Project.origin`) so the implementer doesn't search the whole file.