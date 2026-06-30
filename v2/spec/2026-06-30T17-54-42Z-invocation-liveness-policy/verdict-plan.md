## Verdict — required refinements

### Spec structure (intent alignment)

- Restore **`## Prerequisites`** gating shared-invocation binding doc, v1 idle/wall-clock catalog (`v1-behaviors.md`), and review-debate naming in durable v2 docs — prerequisites are validation gates per spec guidance; intent declares them and the subspec omits them.
- Restore **`## Out of scope`** from intent (signals, kill paths, config knobs, actuator prompt / review-skip presets) — load-bearing anti-creep guards dropped from the draft.

### Behavioral contract depth (`invocation-liveness.md`)

The draft’s acceptance criteria verify presence of topics but not enough substance for a design-only slice whose deliverable *is* the contract. Refine tasks and ACs so the durable doc must include:

- **Non-circular definitions** of stall vs slow work, anchored with positive examples (actuator applying verdict edits; implement touching acceptance-criteria files; read-only debate producing review artifacts) and a negative stall candidate (process up, no output, no outcome-relevant workspace movement).
- **Progress signal categories** at behavioral level: v2 considers multiple observable invocation signals (agent output, workspace activity toward step outcome, step-completion markers), not a single global output-idle timer; defer weights, intervals, and thresholds to first enforcement consumer.
- **Stall-response categories** without kill-path wiring: terminal abort after bounded stall; binding advance when later rungs remain; role-dependent mix — rules out implementers inventing per-phase semantics at enforcement time.
- **Liveness profiles** as behavior × role (cross-link `role-resolution.md`), including distinct stall expectations for read-only debate roles vs `actuator`/`implement`, plus at least one **open-ended** exemplar (`implement` under `write`) contrasted with **short bounded** exemplars (e.g. review-debate actuator apply).
- **Profile shape at category level**: each behavior/role profile may combine stall detection and an absolute ceiling (v1’s parallel idle + wall-clock is the contrast baseline); defer profile tables.
- **Explicit Guarantees section** (or equivalent): what v2 promises operators across profiles at termination and during legitimate long work — without algorithms or timeout tables.
- **Stall ≠ quota**: stall termination is not quota exhaustion; whether stall permits binding advance is separate from quota fallback — defer `failureKind`/telemetry to enforcement consumer.
- **Terminology disambiguation**: **invocation liveness** (step/invocation progress) vs **run orchestration liveness** (`isLive`, daemon/list column) — prevents doc collision with existing v2 terms.

### Cross-doc updates (tasks + ACs)

- **`shared-invocation.md`**: link plus ownership statement must extend the **Boundary** section (invocation owns liveness policy evaluation; workflow loops consume it) — ownership prose without boundary update contradicts current “does not own…” list.
- **`v2-build-order.md`**: sequencing note belongs under **`## Cross-cutting (not phases)`** (alongside quota fallback), stating **policy doc merges before Phase 6 review-debate implementation** — not that enforcement code must ship before Phases 1–5.
- **`v1-behaviors.md`**: align task and AC — either require substantive contrast bullets (idle false-kill, stall riding 30-minute wall, patch-only escalation asymmetry per cataloged v1 behavior) or weaken the task to forward-pointer only; **substantive contrast is preferred** given intent motivation. Note **v1 interim** behavior (e.g. pending `review-actuator-idle-escalation` seed) vs **v2 target** policy to avoid silent contradiction when v1 ships first.

### Decisions ledger (load-bearing additions)

Add to subspec `## Decisions` only where a competent implementer would plausibly choose differently:

- Stall response recorded at category level — rules out per-phase kill semantics invented at enforcement time.
- Progress signals are multi-category and outcome-oriented — rules out v2 contract = global output-idle timer.
- Liveness profiles are behavior × role — rules out phase-name copy-paste of v1 watchdogs.
- Build-order entry under Cross-cutting — rules out burying sequencing inside Phase 6 preamble.
- Doc merge precedes Phase 6 review-debate; enforcement deferred to shared-invocation consumer — rules out reading build-order as “code must ship before any write invocation.”
- Disambiguate invocation liveness from run orchestration liveness — rules out operator/doc collision with `isLive`.
- `shared-invocation.md` Boundary updated — rules out contradictory ownership prose.

Optional record (not blocking): `Deferred to first consumer: human-step interaction with invocation stall termination — pin when Phase 6 human behavior is specced`; `Deferred to first consumer: plan-role liveness profile — pin when plan-mode write steps are the enforcement caller` (if open-ended `implement` exemplar alone suffices, omit plan deferral).

### Acceptance criteria fixes

- Add AC requiring explicit **Guarantees** (or equivalent) section in `invocation-liveness.md`.
- Add AC requiring **substantive v1 contrast** (or align downward if pointer-only is chosen).
- Add AC requiring **role-resolution cross-link** and **read-only vs actuator/implement profile differentiation**.
- Add AC requiring **terminology disambiguation** and **`shared-invocation.md` Boundary** update.
- Tighten “operator-visible progress expectations” AC wording: **in-flight observability of legitimate long work**, not pre-termination stall forensics (termination diagnostics remain deferred).
- Align build-order AC wording: **policy doc merge** before Phase 6, explicit Cross-cutting placement.

### No change required

- Single atomic subspec scope; structural file-exists ACs appropriate for a harness docs subspec where the durable doc is the contract (`documentation-standard.md` single-home rule).
- Deferrals for signal algorithms, timeout tables, and operator-visible stall diagnostics at termination.
- Enforcement implementation, kill paths, and config knobs remain out of scope.
