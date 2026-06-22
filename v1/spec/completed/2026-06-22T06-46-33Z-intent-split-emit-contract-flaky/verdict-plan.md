I've confirmed the central technical claims against source. Verdict follows.

## Verdict — Refinements Required

The spec's core thesis (deterministic mechanical repair replaces re-rolling the model) is sound and well-scoped. But the spec under-specifies the one operation that is genuinely non-trivial — the `name:` repair — at precisely the point where a "mechanical" fix can silently corrupt a file. Pin the following before implementation.

### 1. Split `name:` repair into its three distinct cases (blocker)

The spec treats "set frontmatter `name:` to the slug" as one atomic action, but the existing parser only recognizes a `name:` when the file's first line is `---`. Repair therefore fractures into three structurally different operations:

- **No frontmatter block** → prepend a new `---\nname: <slug>\n---` block.
- **Block present but no `name:` key** → insert the key into the existing block.
- **`name:` present but mismatched** → rewrite the value.

The dangerous case is the second: a naive "prepend a block" creates a *second* `---` block, which the parser may still read as passing while the file is malformed — or corrupts a body that legitimately begins with `---`. The Decisions must distinguish these cases (especially: repair edits the existing frontmatter block rather than blindly prepending), and the ACs must cover each so tests pin the safe behavior rather than an accidental one. This is where "mechanical" can become "silently corrupting" — it is the load-bearing decision of the spec.

### 2. State where repair hooks in, for both paths (blocker)

The two code paths reach validation asymmetrically: the no-commit path calls content validation directly, while the committed path first runs rogue-path and directory-structure gates and then calls the same content validation internally — and the filename/disallowed-name check itself lives *inside* content validation, ahead of the name/prereq checks. As written, an implementer cannot tell whether repair runs blanket over all staged files or only over files that have already passed filename/structure gating. Both are test-pinnable and the intent is recoverable (disallowed filenames and rogue writes still abort), but the spec must state the ordering in one sentence so tests pin the intended behavior. Outcome to fix: repair operates on staged `.md` files after filename/structure gating, before the name/prereq content checks, on both paths.

### 3. Add an idempotency / happy-path-unchanged criterion

No criterion asserts that an already-compliant file is left unchanged. A repair that re-serializes frontmatter could perturb compliant files. Add an AC that an already-compliant file is untouched by repair (or claim the existing happy-path tests as preservation pins per the refactor-AC convention). This also steers the implementation toward the safe shape: touch nothing when both contract elements already hold.

### 4. Don't present a conflated fixture as isolated evidence

AC #2 cites a fixture that lacks *both* a matching `name:` and a `## Prerequisites` section, so it exercises name-repair and prereq-append together rather than proving mismatched-name repair in isolation. The task checklist already calls for per-case tests (missing `name:`, mismatched `name:`, missing `## Prerequisites`); the ACs should rest on those isolated cases rather than the combined fixture.

### 5. Pin the prompt instruction's fate (one sentence)

The split prompt still instructs the model to emit both elements. The intended design is best-effort-prompt plus harness backstop — the instruction stays, repair is the safety net. State this in Decisions, because an implementer could plausibly strip the now-"redundant" instruction, which would *raise* flake pressure on the model's pre-repair output.

### 6. State near-miss headings are out of repair scope (one line)

The prerequisites check matches only an exact `## Prerequisites` heading, so a wrong-level or wrong-case heading (`### Prerequisites`, `## prerequisites`) reads as absent and repair appends a second section. This is defensibly out of scope — a wrong-level heading is a model formatting error, not a mechanical absence, and the spec's first Decision already excludes lossy reformatting in spirit. But it is currently silent. Add one line declaring near-miss/wrong-level headings are treated as absent (repair appends, does not promote), so the boundary is explicit rather than accidental.

### Not requiring change

- The base cost of a single-behavior intent run remains, but the model-free passthrough is correctly deferred in the spec's Decisions, and the spec's flake-elimination claim is accurate about the flake. No change.
- Naming internal symbols and the `must declare name:` string in ACs is appropriate for a harness subspec, where internal structure is the contract.
- Doc updates correctly include `v2/docs/v1-behaviors.md`, satisfying the change-existing-behavior rule.

### Rationale

The intent asks for a *robust* mechanical contract, not a re-roll. Robustness fails if the repair itself can corrupt — so the `name:`-case split (#1) and the hook-point ordering (#2) are not polish; they are the difference between the fix working and the fix introducing a new, quieter failure mode. The remaining items (#3–#6) are low-cost precision fixes that make the ACs pin real, isolated behavior rather than incidental fixture overlap, consistent with the spec-guidance requirement that criteria verify observable behavior and that refactor/preservation criteria cite their pinning tests.