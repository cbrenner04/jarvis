## Verdict — required refinements

### 1. `v1-behaviors.md`: revise, do not delete the TUI ink section

The `### TUI ink rendering and launch field collection` section documents two concerns: launch field collection via `collectLaunchFieldsViaInk` (gone with the module) and the surviving `loadInkUi` ink/Yoga boundary used by monitor, log-follow, and feedback (still live). The spec task says remove the entire section; the AC only forbids field-collection citations. A revised section that keeps the ink-boundary parity bullet satisfies the AC but not the task.

**Required outcome:** Align task, AC, and Documentation updates to **revise** the section — drop field-collection claims and deleted source citations; retain the `loadInkUi` boundary bullet with surviving module sources only. Spec guidance requires `v1-behaviors.md` updates when observable behavior docs change; deleting the whole section rots the parity baseline for surviving TUI ink surfaces.

---

### 2. Fixture purge: align three durable docs plus end state for `v2/test/fixtures/`

Deleting both demo fixtures leaves stale references in `coding-standards.md` (line 14), `v2-vision.md` (lines 24, 35), and `v2-architecture.md` (line 67), none of which are in the spec's Documentation updates, tasks, or ACs. `coding-standards.md` is the operator path for Biome-gate manual verification via those fixtures.

**Required outcome:**
- Add doc tasks/ACs for all three files so they no longer describe an active `v2/test/fixtures/` Biome-demo directory after the purge.
- Record a Decision on the post-purge operator verification path: accept no checked-in demo fixtures and document ephemeral copy-paste verification inline in `coding-standards.md`, **or** explicitly defer a replacement demo path to a future seed (`Deferred to first consumer: …`).
- Pin the fixtures end state: after both `.ts` files are gone, the Decision already says delete the README if no demos remain — align task and AC to that outcome (delete `v2/test/fixtures/README.md` and the directory, or equivalent absence AC). "Update README" plus "does not document deleted files" allows an empty stub that violates the Decision.

---

### 3. Intentional Yoga-TDZ smoke-guard removal needs an observable AC

Decision 3 records that the `loadInkUi` smoke test is not relocated. That is deliberate dead-weight removal (the test's sole non-mocked caller is the deleted module), but `bun run test:v2` green does not prove the guard is intentionally gone.

**Required outcome:** Add an AC that pins the intentional regression drop — e.g. no `smoke: loadInkUi` test remains under `v2/src`, or `write-behavior.md` Verification omits the Yoga-TDZ regression sentence. Without this, implementers can satisfy file-deletion ACs while the durable docs still claim CI guards the regression (#7 below).

---

### 4. `write-behavior.md` AC must match the task scope

The task removes both the `tui-field-collector.test.tsx` citation **and** the `loadInkUi` smoke/Yoga-TDZ guard sentence (lines 308–309). The AC only forbids citing the test file; the Yoga-TDZ sentence could remain while the AC passes.

**Required outcome:** Broaden the `write-behavior.md` AC so Verification omits both the deleted test citation and the Linux/Bun Yoga-TDZ `loadInkUi` smoke-guard claim.

---

### 5. Prerequisites hygiene

Intent declares a prerequisite on seed 01 (lean doc standard + in-process daemon-test defaults); the spec has no `## Prerequisites` section, so plan-mode's prerequisite gate will not run. This deletion slice does not depend on seed 01 for correctness.

**Required outcome:** Add a `## Prerequisites` section mirroring intent for gate consistency, **or** drop the prerequisite from intent if purge work is intentionally unordered relative to seed 01. Pick one; do not leave intent and spec divergent.

---

### Optional (non-blocking)

- **Decision line on deliberate reversal:** A one-line Decision noting the Yoga-TDZ CI guard added by completed specs `tui-ink-renderer-isolation` / `tui-ink-linux-bun-regression-ci` is intentionally dropped until a TUI workflow launcher consumer pins relocation — aids reviewer context, not implementability.
- **`write-loop-input.ts:11` stale comment** ("TUI collector"): survives deletion and passes the scoped `rg` AC; fix only if comment hygiene is explicitly in scope for this slice.
