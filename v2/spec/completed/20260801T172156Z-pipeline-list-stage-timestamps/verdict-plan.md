Verifying key codebase claims so the verdict reflects what's actually in the repo.
## Verdict: required refinements

### 1. Name the failing-test pin in the behavioral AC

The new-behavior acceptance criterion must cite the **exact test title** that fails on pre-fix code and passes after implementation—not only `daemon-pipeline-observation.test.ts` and `projectPipelineSnapshot`. The file already uses named pins with `Mutation checkpoint:` comments (e.g. `projectPipelineSnapshot includes createdAt and null finishedAtMs…`, `two-branch pipeline_list projection includes branchKey…`). Without a named pin, an implementer can satisfy the prose by burying assertions in an existing test.

**Rationale:** Spec guidance requires runtime-behavior subspecs to name the specific failing test; prose-only ACs are ambiguous.

### 2. Guard inversion must cover `startedAt` and `endedAt` independently

The mutation-checkpoint obligation must ensure omitting **only** `startedAt` or **only** `endedAt` from stage projection turns the pin RED—not a bundled “either field” checkpoint that could stay green when one field is still projected. Match repo precedent (`branchKey` gets its own checkpoint) or use a strict `toEqual` that fails if either field is missing.

**Rationale:** Spec guidance requires inverted guards for each added projection field; bundling two independent fields into one checkpoint does not satisfy that.

### 3. Resolve Tasks vs AC mismatch on `pipeline_list` end-to-end coverage

Tasks promise `pipeline_list` end-to-end coverage when stages carry lifecycle times, but no acceptance criterion names that test or its assertions. `handlePipelineList` is thin projection wiring, so a unit pin on `projectPipelineSnapshot` is sufficient **if** Tasks drop the e2e language. If Tasks keep e2e, an AC must name the test (likely an update to `pipeline_list reports every admitted pipeline with identity, derived state, and ordered stage projection` or the two-branch fan-out test).

**Rationale:** Tasks and ACs must not contradict; implementers need a single verifiable contract for wire-level vs projection-only coverage.

### 4. State millisecond semantics in Decisions

Decisions specify `number | null` but not that values are **milliseconds since epoch**, consistent with pipeline `createdAt` and durable `started_at`/`ended_at` columns. Add that convention explicitly.

**Rationale:** Wire shape is the contract; consumers (TUI, CLI) must not infer units from type alone.

### 5. New pin must cover unset (`null`) and running-stage asymmetry

The new failing-test pin must assert explicit `null` for unset durable timestamps (not only set values) and include a **running** stage row with `startedAt` set and `endedAt` null—the motivating operator case. Copy-from-durable semantics handle this mechanically, but the spec should require it in the pin so the AC is not satisfied by a fixture that only tests terminal stages.

**Rationale:** Intent problem text centers on elapsed display for in-progress stages; a pin that only covers completed stages would not guard the deliverable’s purpose.

### 6. Route implementers to existing strict `toEqual` tests that must change

Two existing tests use exact stage-row `toEqual` without `startedAt`/`endedAt` and will break on implementation:

- `pipeline_list reports every admitted pipeline with identity, derived state, and ordered stage projection`
- `two-branch pipeline_list projection includes branchKey per durable row`

Name these in **Tasks** (or as update ACs) so implementers know which pins to extend. `bun run test:v2` forces fixes mechanically, but the spec should not leave touch surface implicit.

**Rationale:** Refactor/update routing pattern—cite the tests that must change rather than paraphrase “update tests.”

### 7. Align `intent.md` documentation list with the subspec

The subspec correctly adds `v2/docs/v1-behaviors.md` per behavior-change guidance; `intent.md` still lists only three docs. Align the intent seed doc list with the subspec’s four-file obligation for traceability. The subspec remains authoritative for implementation.

**Rationale:** Intent ↔ subspec drift on enforceable doc scope confuses review and downstream intent consumption; not scope creep—the v1-behaviors update is warranted.

---

**Not required (no split, no blocker):** Single subspec on one module boundary is appropriately atomic. Dispatch lifecycle population, elapsed formatting, and TUI rendering remain correctly out of scope. Duplicate doc bullets under Acceptance criteria and Documentation updates are acceptable. Reintroducing `## Prerequisites` in the subspec is optional implementer context. Fan-out per-branch timestamp independence is covered if the two-branch test is cited and updated with per-row timestamp expectations; a separate fan-out AC is optional, not mandatory.