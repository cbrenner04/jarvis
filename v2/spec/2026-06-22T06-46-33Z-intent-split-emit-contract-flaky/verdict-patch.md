## Verdict — Refinements Required

The implementation produces correct abort/pass outcomes and the suite is green, but several explicit Decisions about *how* repair is bounded are not enforced in code — including the load-bearing safety Decision the spec was written around. The following must be addressed.

### Required outcomes

**1. Unterminated frontmatter must not be silently wrapped in a second `---` block (blocker).**
Decision #3 explicitly rules out the silent-corruption case where repair "blindly prepends a second `---` block." The current name-repair treats both "no leading `---`" and "leading `---` with no closing `---`" identically, falling into the prepend-a-new-block branch. For a file that opens with `---` but never closes it, this produces a duplicate-`---` shape — exactly the malformed output the case-split was designed to prevent. The repair must distinguish "no frontmatter block" from "unterminated/malformed frontmatter block" and must not emit a second `---` block in the latter case. Because this is the precise silent-corruption failure mode the spec's central safety Decision targets, it must be fixed and pinned with a test.

**2. Repair must not modify files that should abort on filename/structure grounds (spec fidelity).**
The spec's hook-point Decision is explicit and was pinned as a blocker: repair operates on staged `.md` files *after* filename/structure gating (rogue-path, directory-structure, disallowed-filename, duplicate-slug) and *before* the `name:`/`## Prerequisites` content checks, on both paths. As implemented, repair runs *before* the filename/duplicate-slug gate on both paths, so a disallowed-filename file (e.g. an ordering-prefixed `01-foo.md`) gets `name:` written into it before the run aborts. The observable end-state is still safe (the stage dir is ephemeral and discarded on abort, with no `ready-intents/` writes or PR), but the stated ordering is inverted. Restore the specified ordering so that files failing filename/structure gating are never touched by repair. The required outcome: a file destined to abort on filename/duplicate-slug/structure grounds is not rewritten by the repair pass.

**3. Pin the near-miss-heading behavior with a test (AC #4 coverage gap).**
AC #4 requires that a wrong-level/wrong-case `## Prerequisites` near-miss heading (e.g. `### Prerequisites`, `## prerequisites`) is treated as absent — repair appends an empty `## Prerequisites` section and leaves the near-miss heading in place (does not promote it). The code behaves correctly, but the only missing-prerequisites fixture has no heading at all, so the "not promoted" behavior the spec specifically flagged as subtle has zero coverage. Add a fixture with a near-miss heading that asserts both the appended empty section and the untouched original heading.

### Minor (address if low-cost; not blocking)

- **Empty `name:` value should edit in place, not insert a duplicate key.** A frontmatter line of `name:` with no value currently causes a second `name: <slug>` line to be spliced in. Validation still passes (the parser skips the valueless line and reads the inserted slug), so this is cosmetic residue, not a functional defect — but it contradicts the "edits the existing block in place" Decision in letter. Fix if cheap.
- **One no-commit per-case test for defense-in-depth.** AC #6 (repair applies on both paths) is satisfied by the wiring plus the existing mismatched-name no-commit test, so this is not an AC violation. Adding a single no-commit variant of one repair case strengthens the both-paths guarantee but is optional.

### Rationale

The intent asks for a *robust* mechanical contract that replaces re-rolling the model. Robustness fails if repair can itself corrupt a file — so outcome #1 is not polish; it is the difference between the fix working and the fix introducing a quieter failure mode, and it directly contradicts the Decision that motivated splitting name-repair into cases. Outcome #2 restores a blocker-level Decision the spec deliberately pinned; though behaviorally inert today, leaving it inverted means the code's bounds no longer match its stated contract. Outcome #3 closes a gap between an accepted criterion and its pinning test, per the spec-guidance requirement that criteria verify observable behavior.