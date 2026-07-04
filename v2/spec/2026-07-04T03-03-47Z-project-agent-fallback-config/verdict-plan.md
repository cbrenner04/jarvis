## Verdict: Required Refinements

**1. Type-pin `agents` element type.**
Subspec 00 must state `agents` is `string[]` (agent-adapter name strings) inline, not left to cross-reference with `agent-model-config.md`.

**2. Define behavior for structurally invalid `projects.json` (single consolidated decision).**
The spec currently only covers two soft cases (file absent, project entry absent → `undefined`) and two hard-error cases (duplicate names, empty list). It does not say what happens when the file is present but malformed: unparseable JSON, `projects` not an object, a project's `agents` not an array, or an `agents` array containing non-string entries. Add one Decision covering all of these: any structurally invalid `projects.json` (fails to parse, wrong shape, non-string entries) is a hard load error — only true *absence* (missing file, missing project key) returns `undefined`. Add a corresponding acceptance criterion. This keeps "absent vs. present-but-broken" behavior consistent and prevents silently misinterpreting garbage config as "no override."

**3. Close the `run start` coverage gap.**
Subspec 01's task checklist commits to wiring both `jarvis write` and `jarvis run start` through the project-config fallback, but every acceptance criterion only exercises `jarvis write`. Either add an acceptance criterion covering `jarvis run start` precedence, or state explicitly (as a decision) that both commands route through the same `buildWriteLoopInputFromCliValues`/CLI-values path, making the existing `write` ACs sufficient proof for both. Untested committed functionality violates the behavioral-acceptance-criteria guidance.

**4. Document the two-file agent-fallback-config landscape.**
`~/.jarvis/config.json` (v1, `modes.patch.agentOrder`) and the new `~/.jarvis/projects.json` (v2, this spec) are both per-machine outer-fallback-order stores for a similar concept, with no separation of concerns noted anywhere for the operator. Add a one-line note (in the subspec 00 or 01 doc-update section, in `agent-model-config.md`) distinguishing the two so an operator/reader isn't confused about which file governs which surface.

**5. Add a `## Prerequisites` entry for `--project` being required.**
Subspec 01 depends on `--project` already being a required, existing CLI flag for `write`/`run start` — this is a genuine design dependency (no fallback path exists if it weren't already required) and should be named per spec-guidance's prerequisite criteria, not left implicit.

No refinement needed for the doc-edit sequencing between subspecs 00 and 01 (additive, sequenced by merge-first rule) — not a spec defect.