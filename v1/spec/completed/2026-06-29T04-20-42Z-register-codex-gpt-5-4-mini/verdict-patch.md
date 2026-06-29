## Verdict

### 1. Manual CLI gate — merge blocker

The spec requires owner-confirmed `codex exec` reachability for `gpt-5.4-mini` (or the actual CLI slug) before merge. Prerequisites are empty and the manual AC (`Live codex exec --model <verified slug> accepts the model`) is unchecked.

**Required:** Do not merge until the operator runs live `codex exec --model <slug>`, confirms acceptance, records the result in `## Prerequisites`, and checks the manual AC. If the verified slug differs from `gpt-5.4-mini`, record it and align passthrough expectations and tests to that slug.

**Why:** Registration is meant to enable real runs, not only config validation. Fake-spawn tests pin passthrough only; they cannot satisfy this gate.

---

### 2. Completion state must match the manual gate

`index.md` marks the subspec complete while the manual AC remains open.

**Required:** Completion markers must be consistent — either keep the subspec incomplete until the manual AC passes, or check the manual AC only after verification is recorded. Do not leave the index checked with the manual AC open.

**Why:** Checked index implies full completion; an open manual AC contradicts that and hides the remaining merge blocker.

---

### 3. AC #3 overclaims “verified” CLI slug

AC #3 is checked and says CodexAgent passes the **verified** CLI slug. Tests only assert passthrough of the configured string; verification is the manual gate.

**Required:** Align AC #3 with what automation actually pins — e.g. “passes the configured model string to `codex exec --model`” — **or** leave it referencing a verified slug but keep it unchecked until the manual gate passes. Do not leave a checked AC that claims verification automation has not performed.

**Why:** Checked acceptance criteria must not overstate test coverage; “verified” belongs to the manual gate unless wording is narrowed.

---

### 4. Stale `## Tasks` checklist

All six tasks are implemented and covered by checked AC, but `## Tasks` entries remain `[ ]`.

**Required:** Tick the completed tasks or remove the `## Tasks` section. AC are the authoritative completion pins.

**Why:** Unchecked tasks imply missing work and add review noise.

---

### Upheld without actuator action

- **Registration code:** `CODEX_PRICE_KEYS`, `data/prices.json`, price-key/config/spawn/attribution/cost tests, and unchanged defaults match the narrowed spec.
- **Cost pinning:** Seed-row + `computeCost` → `computed` with non-null `cost_usd` meets the spec; stronger than the `gpt-5.4` seed precedent. No correlated-session integration test required.
- **`cache_write_per_mtok` omission:** Inherited from owner snapshot and `gpt-5.4` row shape; not a defect.
- **Documentation:** `## Documentation updates: None` is correct for registration-only opt-in.
- **Quota pool:** Correctly deferred per spec.
- **Optional improvements** (`toBeCloseTo` on cost, attribution `test.each` pairing): not required by spec; may be done opportunistically.
