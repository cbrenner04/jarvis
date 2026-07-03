## Verdict — required refinements

### 1. Harness path enumeration (`test/test-slices.test.ts`)

**Outcome:** Task and AC must pin updating the hardcoded `v2/src/log-stream.sandbox-unrunnable.test.ts` entry to `v2/src/persistence/…`.

**Rationale:** Layout-contract already established this co-update pattern for `preload.sandbox-unrunnable.test.ts`. Without it, `bun run test` fails even when persistence tests pass.

---

### 2. IPC sandbox spawn path (`ipc.sandbox-unrunnable.test.ts`)

**Outcome:** Add a preservation AC citing `ipc.sandbox-unrunnable.test.ts` (embedded `join(import.meta.dir, "..", "log-stream.ts")` in the writer script, not only static imports).

**Rationale:** Task names ipc spawn paths; no AC today. Import-only fixes can leave cross-process tail wake broken while persistence ACs pass.

---

### 3. `typecheck` as acceptance criterion

**Outcome:** Promote `bun run typecheck` from checklist-only to an AC.

**Rationale:** Patch agents tick acceptance criteria, not task checklists. Path-only breakage is plausible without a failing cited test.

---

### 4. `telemetry-capture.md` out-of-scope rationale

**Outcome:** Remove or replace the claim that those docs have no persistence path entries. Either (a) add `telemetry-capture.md` `../src/log-stream.ts` citation fixes to documentation updates, or (b) record an explicit named deferral (owner slice) for the broken links.

**Rationale:** Links exist at L29 and L189 and will rot after the move. Intent may limit scope to `state-store.md`, but a false justification must not stand. Layout-contract policy: cross-doc path fixes land with relocation subspecs — two-link fix is low cost if kept in slice.

---

### 5. `v2-architecture.md` persistence row drift

**Outcome:** Add `v2-architecture.md` to documentation updates: reconcile the persistence domain **Root modules (today)** row (or equivalent one-line post-move note) so **Source layout** does not contradict the relocated tree this slice depends on.

**Rationale:** Prerequisite cites **Source layout**; leaving flat-root inventory after move contradicts the doc the spec anchors on. Full matrix reconciliation is not required — persistence row only.

---

### 6. Intent import rule vs committed execution edges

**Outcome:** Align `intent.md` with the subspec: persistence may retain type-only imports to `../invocation-failure.ts` and `../write-loop.ts` (path fixes only).

**Rationale:** Intent’s “Persistence imports `shared/` only” oversimplifies and can mislead implementers who read intent without the subspec.

---

### 7. Importer discovery wording

**Outcome:** Broaden the grep/discovery instruction beyond `log-stream` / `state-store` basenames to include `state-store-types` (and persistence path patterns as needed).

**Rationale:** Importers such as `daemon-wire.ts`, `write-loop.ts`, and `run-operator-error.ts` use `state-store-types` and will not surface under basename-only grep.

---

### Optional (not blocking merge)

- Preservation AC for `ipc.test.ts` — reasonable extra pin for the `ipc/` importer surface; aggregate `bun run test` is backstop.
- One daemon consumer AC (e.g. `daemon-tail-stream.test.ts`) — further reduces refactor AC gap; not required if aggregate test gate remains in checklist.
- Append `; verify with bun run test:integration:v2` to sandbox-unrunnable ACs — weaker than cross-process slice convention; acceptable as-is.
- `## Prerequisites` re-gate — layout contract is already merged; belt-and-suspenders only.

---

### Upheld as sufficient (no refinement)

- Six-file inventory and `git mv` shape.
- Execution type-edge path semantics (`../invocation-failure.ts`, `../write-loop.ts`).
- Single-subspec atomicity.
- `state-store.md`-only behavioral doc scope (plus items above).
- Structural file-placement AC for a relocation slice.
- No `v1-behaviors.md` update (behavior-preserving).
- Biome boundary enforcement, extensionless `./state-store-types`, and `log-stream.sandbox-unrunnable` self-`import.meta.dir` reference — correctly out of scope or no-op after co-move.
