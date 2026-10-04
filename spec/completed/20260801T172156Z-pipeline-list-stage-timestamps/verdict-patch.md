Verifying the advocate's doc-gap claims and implementation against the spec before issuing the verdict.
## Verdict: required outcomes

### 1. Align `write-behavior.md` “List vs wait” with the updated command table

**Outcome:** The “List vs wait” section must describe the same stage-row fields as the `jarvis pipeline list` command table — including nullable `startedAt` and `endedAt` (ms) — not only `branchKey`.

**Rationale:** The command table was updated per the subspec doc AC; the adjacent operator-facing paragraph was not. Readers who skip the table still see an incomplete wire contract. Same-file inconsistency on a behavior this subspec changed.

---

### 2. Document stage timestamp semantics in `daemon-host.md`

**Outcome:** The durable `pipeline_list` home must state that per-stage `startedAt` and `endedAt` are milliseconds since epoch and `null` when unset — in the same style as pipeline-level `createdAt` / `finishedAtMs` prose in that section.

**Rationale:** Subspec Decisions fix ms + explicit-null semantics; `write-behavior.md` and `v1-behaviors.md` already carry `(ms)`. `daemon-host.md` lists the fields in the RPC table and JSON block but omits units/nullability. For the primary wire-contract doc, field names alone are insufficient.

---

### Not required (no actuator action)

- **Core projection and tests** — `projectPipelineSnapshot` copies durable timestamps; unit pin with separate mutation checkpoints; e2e shape enforcement via strict `toEqual` / `projectedStage`; four cited docs updated; typecheck/`test:v2` green. Meets the subspec.
- **`pipeline.test.ts` CLI mocks** — Stale fixtures are maintainability debt; not cited in Tasks or AC; passthrough CLI tests still pass. Follow-up, not a blocker.
- **Live dispatch assertion, e2e non-null round-trip, two-branch timestamp realism, `?? null` coercion, runtime schema validation, TUI fixture realism** — Out of scope or adequately covered by the named pins; optional hardening only.