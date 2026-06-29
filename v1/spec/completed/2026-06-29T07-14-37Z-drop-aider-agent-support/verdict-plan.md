## Verdict — required refinements

### 1. Grep acceptance criterion is unsatisfiable as written

The AC `grep -rin aider` with exclusion limited to `v1/spec/completed/**` cannot pass on a merged tree.

**Outcomes required:**
- Pin an explicit grep scope aligned with intent: exclude historical `reports/**`, the self-referential active spec tree, and other paths that legitimately contain `aider` without implying harness support.
- Record load-bearing decisions for each exclusion and the plausible wrong alternative each rules out (e.g. rewriting archived specs/reports, renaming `.gitignore` patterns to dodge substring matches).
- Realign with intent’s “clean outside historical reports” — not `completed/**` alone.

**Rationale:** Behavioral ACs must be verifiable post-merge. A removal spec that names `aider` throughout cannot satisfy a repo-wide grep; intent and spec guidance both require observable, non-self-referential criteria.

---

### 2. Operator-facing doc surface is incomplete

`README.md` has five `aider` hits; it is not in doc-stripping tasks.

**Outcome required:** Extend doc tasks/AC so operator-facing README matches the four-adapter reality (same bar as `v1/docs/*.md`).

**Rationale:** README is operator workflow docs per documentation-standard placement; leaving it contradicts the intent’s end-to-end removal.

---

### 3. Test harness fixture gap: `test/setup-fake-agents.ts`

Fake-binary loop still includes `aider`; neither intent nor spec mentions it.

**Outcome required:** Task to drop `aider` from shared fake-agent setup; covered by existing suite AC.

**Rationale:** Omission leaves dead fixture wiring that can mask regressions or confuse future agent work.

---

### 4. Stale ready-intent delete task

Task to remove `v1/spec/ready-intents/drop-aider-agent-support.md` is a no-op — file was consumed during plan authoring.

**Outcome required:** Drop the delete-noop; keep rewording remaining active ready-intent `aider` references (`opencode-ollama-local-model-run.md` still cites “dropped aider path”).

**Rationale:** Stale tasks mislead implementers and grep hygiene.

---

### 5. Active sibling spec will fail grep or leave dangling references

`spawn-quota-before-model-config` preservation AC still cites `aider.test.ts`; verdict mentions `aider-model-warnings.md`.

**Outcome required:** Either sibling-spec `aider` hygiene is in-scope (update checked AC / verdict prose), or active `v1/spec/**` is an explicit grep exclusion with a decision entry — not “clean only after spec auto-moves to completed.”

**Rationale:** Grep AC and cross-spec consistency; implementer cannot satisfy both without a pinned choice.

---

### 6. Plan-test replacements need pinned choices

Tasks name two plan test files but leave agent choice, failure mode, and fixture naming loose.

**Outcomes required:**
- Pin replacement agent for plan tests (`opencode` is the natural successor given ready-intent coupling).
- Pin how each test achieves its failure semantics after swap (e.g. `plan-no-commit-intent-output` currently exercises config validation failure for `aider`, not spawn failure — fixture must be redesigned, not naïvely renamed).
- Pin stub strategy for `plan-command.sandbox-unrunnable` (aider’s browser-launch rationale does not transfer).
- Pin neutral `specDirBasename` rename where slug embeds `aider`.

**Rationale:** Load-bearing test contracts; loose “remaining opt-in agent” invites wrong failure modes and grep failures.

---

### 7. `v2/docs/v1-behaviors.md` task under-scopes the AC

AC requires full de-aider of the behavior catalog (seven bullets today); task names only two themes.

**Outcome required:** Task breadth must match AC — remove all `aider` bullets and dead links (including `aider-model-warnings.md` references).

**Rationale:** `documentation-standard.md` mandates v1-behaviors updates on behavior change; narrow task risks partial baseline rot.

---

### 8. Decision ledger gaps for grep and collateral

**Outcomes required:** Add decisions for:
- `.gitignore` `.aider*` — keep pattern; exclude from grep (rules out rename-to-dodge).
- `reports/**` — exclude per intent.
- Active `v1/spec/**` — exclude or edit siblings in-scope.
- Ready-intent reword strategy for `opencode-ollama` (rules out leaving historical comparison text).

**Rationale:** Spec guidance requires load-bearing decisions where plausible alternatives exist; grep scope is the central unresolved fork.

---

### 9. Telemetry no-price coverage — explicit delete-or-replace choice

`telemetry-enrichment.test.ts` has aider-specific no-price path; spec is silent on whether deletion is sufficient.

**Outcome required:** One decision: delete if redundant with existing opencode no-price coverage, else add one opencode equivalent — not left to implementer guess.

**Rationale:** Prevents silent coverage loss while avoiding duplicate tests the advocate correctly flagged as overreach elsewhere.

---

### Upheld without refinement (direction sound)

- Single atomic subspec, hard `unknown agent` rejection, no deprecation shim, surgical quota/price strip, delete-not-redirect docs, four-adapter preservation AC + full `bun run test`/`typecheck`, `v1-behaviors.md` inclusion.
- No requirement to cite every touched test file in preservation ACs, rewrite `config.test.ts` trio for another agent, or rewrite `run.test.ts` “constructs AiderAgent” — delete is correct.
- Optional sequencing note that `opencode-ollama` ready-intent assumes aider dropped — prerequisite note acceptable, not blocking.
