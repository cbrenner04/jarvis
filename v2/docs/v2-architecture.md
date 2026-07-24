# Jarvis v2 — Architecture

The decided v2 architecture, worked out through design interviews. Companion to
`v2-vision.md`: the vision owns the *why* and the constraints/guiding
principles that govern the design; this doc owns the *how* — the layered model,
prompts, workflows, config, the execution model, and the runtime.

## Source layout

Canonical `v2/src/` domain map, import direction, and entrypoint policy — not
duplicated in per-domain docs. Role-based directories with co-located tests.

### Domain map

| Domain | Directory |
| --- | --- |
| CLI host | `cli.ts` (entry) + `v2/src/cli/` (dispatch helpers: deps, IPC, revision/stale-dispatch checks, run completion, usage) |
| Command handlers | `v2/src/commands/` (`run`, `workflow`, `write`, `daemon`, `config`, `tui`, `cleanup`) |
| Config loading | `v2/src/config/` (machine config/profile loaders, `agent-model-config`) |
| Daemon host | `v2/src/daemon/` (daemon, wire parsers, lifecycle, process log, memory watermark, run-operator-error, workflow rollup/snapshot) |
| Execution library | `v2/src/execution/` (write loop, workflow runner/loader/presets, step builders, review cycles, publication, completion) |
| IPC transport | `v2/src/ipc/` (framing codec, client/server, RPC transport/errors) |
| Persistence library | `v2/src/persistence/` (`state-store`, `log-stream`) |
| TUI host | `v2/src/tui/` (ink monitor/log-follow, daemon client) |
| Test support | `v2/src/testing/` |

Root keeps only the pinned entrypoints and cross-cutting modules: `cli.ts`,
`daemon-entrypoint.ts`, `paths.ts`, and their co-located tests.

### Import direction

| From | May import |
| --- | --- |
| Hosts (`cli`, `daemon`, `tui`) | Libraries + `ipc/` + `shared/` + sibling hosts (composition) |
| Execution library | Persistence + `shared/` |
| Persistence library | `shared/` only (type-only → execution/config: committed exceptions) |
| `ipc/` | `shared/` only |
| `testing/` | Anything |
| Production code | Not `testing/` |

**Committed exceptions:** persistence may **type-import** from execution/config
(e.g. `state-store.ts` ← `InvocationFailureDetail`, `WriteLoopInput`;
`log-stream.ts` ← `WriteLoopOutcomeKind`, `PublicationFailure`) — never value
imports. `log-stream` ↔ `write-loop` is a mutual type-only dependency
(execution imports `LogSink` from persistence). Hoist shared types to `shared/`
before adding new cross-library edges; no silent value imports across
libraries.

### Entrypoints

Pinned at `v2/src/` root; relocate only with every caller in the same change set.
`bin/jarvis` → `../v2/src/cli.ts`; `daemon-lifecycle` spawns
`resolve(import.meta.dir, "../daemon-entrypoint.ts")`.

### Conventions

- **Co-located tests:** `*.test.ts(x)` beside modules under `v2/src/<domain>/`;
  no parallel `v2/test/` mirror of `v2/src/`.
- **No barrel `index.ts` re-exports.**

## The layered model

The smallest pieces of Jarvis split across four layers — two in source, two in
config. Naming them separately is what keeps the design from feeling tangled.

| Layer | Lives in | What it is |
| --- | --- | --- |
| **Behaviors** | source | Loop primitives: write, review, review-debate. See [`role-resolution.md`](role-resolution.md). |
| **Prompts** | source | Per-behavior prompts, rendered by layering fragments + per-step overrides. |
| **Workflows** | source | Named, linear-with-loops sequences of **steps** (behavior + prompt + output contract + role). No agent/model. |
| **Project config** | data (`~/.jarvis`, per machine) | Per project: enabled workflows + the agent fallback order. Role→model bindings live separately, in a machine-independent store. |

**Terminology change.** The earlier framing of a "building block = prompt + agent" is retired.
The reusable source unit is a **step** (behavior + prompt + output contract); a step names a
**role**, never a concrete model. The **agent** is a per-machine fallback order and
the **model** resolves per agent from the step's role — neither is baked into the step.
See [`role-resolution.md`](role-resolution.md) for the closed `Role` union.
Keeping "building block" as "prompt + agent" is exactly what pulls the design back toward
baking models into source, so we drop the term.

## Prompts

Every word has meaning; prompts are composed with care and treated as code.

Decided:

- **Prompts are source code.** New or changed prompts ride in via reviewed Jarvis
  updates. They are stable and reusable enough that a data/CMS layer isn't worth
  the confusion it would add. (Resolves the old "does every new prompt go through
  a Jarvis update?" — yes.)
- **Organized by behavior.** The prompt tree mirrors the behavior vocabulary.
- **Rendered by layering fragments + explicit overrides.** Fragments have scope:
  *overarching* (global, e.g. terseness rules) and *behavior-specific* (planning
  rules ≠ implementation rules). A rendered prompt = global fragments → behavior
  fragments → the step's task text, applied as a default layering. A step can
  **explicitly override** the default — add or remove specific fragments when
  it's the exception.

Designed and shipped (#121/#122): the `prompts/` layout, fragment taxonomy, the
override syntax, and the rendered-prompt snapshot test standard (a prompt edit
can shift `jarvis1` output, so changes are kept visible via revision-keyed
snapshots). The canonical as-shipped contract is [`../../v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md).

## Workflows & orchestration

Composability is paramount. A workflow is a linear (with loops) array of steps.
Different projects need different postures — heavier review for sensitive repos,
YOLO for others, fast short-circuits for small tasks — without changing the
underlying behavior or prompt implementations.

Decided:

- **All workflows live in Jarvis source.** Built as they come / as projects need
  them, not predicted up front. Short-circuits aren't a special mechanism — a
  "quick implement, skip review" path is just another named workflow. We avoid
  source that exists only in the name of flexibility. (Resolves the old "should a
  new workflow go through a Jarvis change?" — yes, it's source.)
- **A workflow scaffolding helper.** Since workflows are authored often, ship a
  generator that stubs a new workflow (steps referencing prompts + contracts).
- **Steps reference prompts and a role, never a concrete agent/model.**
  The agent fallback order and the per-agent model are config.
- **Authoring reuse via named step-groups.** A workflow can embed a reusable
  sub-sequence (e.g. `review-bundle` = code-review + security-review) so step
  lists aren't repeated across workflows. Keep nesting **shallow — one level, no recursion** —
  workflows stay linear-with-bounded-loops, never arbitrary graphs.
- **Steps have stable IDs.** Role-bearing step bindings and their resolved
  role/agent pairs follow IDs, not positions; reordering or inserting steps
  must not silently re-target resolution.

Per-project config:

- **No Jarvis artifacts in target repos.** Jarvis is used on personal repos and
  at work where the setup isn't ours and personal artifacts aren't welcome. A
  project opts into workflows and its agent order entirely in `~/.jarvis` (the
  role→model store is separate and machine-independent, below).
- **Two axes: agent fallback order vs. model resolution.** v1 conflated them — each
  `modes.{patch,plan}.agentOrder` entry is one `{agent, model}` pair, so the
  availability chain and the model choice are a single list. v2 splits them, since
  the hierarchy exists for *agents* (preference-then-fallback) and a model always
  attaches to a specific agent (codex can't serve a Claude model):
  - **Agent fallback order** — one ordered list of agents (`claude → codex →
    cursor → opencode`), the availability/quota chain. Lives in **per-machine**
    `~/.jarvis` config: which agents are installed/licensed genuinely differs
    between the personal and work machines.
  - **Role→model bindings** — each workflow step names a **role** (see
    [`role-resolution.md`](role-resolution.md)); the store maps `(agent, role) →
    ordered model rungs` (`AgentModelConfig`). Lives in a **checked-in
    per-machine-profile file** (`config/machines/<profileName>.json`), not
    `~/.jarvis/config.json`: the `agents` key in `~/.jarvis/config.json` is agent-order-only. Schema,
    validation, flattening, and price derivation:
    [`agent-model-config.md`](agent-model-config.md).
- **A step names a role, not a model.** The runner walks the agent fallback
  order; for whichever agent it lands on, it resolves `(agent, role) → rungs`
  from the store and walks the inner rung list. Step→role bindings follow the
  closed union in [`role-resolution.md`](role-resolution.md) — e.g. write-loop
  implement steps bind `implement`; plan draft/refine bind `plan`; review debate
  binds `adversary`, `advocate`, `adjudicator`, then `actuator`.
- **One ordered rung list per (agent, role); a gap is a hard error at load** —
  no skip, no default fallback. Load rules and validation matrix:
  [`agent-model-config.md`](agent-model-config.md).
- **Nested fallback: outer `agents` order, inner rungs per `(agent, role)`.**
  Both axes advance on **quota** only; `model_config` and `error` are terminal.
  Flattening, consumption modes (`actuator` head-only), and composition:
  [`agent-model-config.md`](agent-model-config.md).
- **CLI override.** Target: `--agent` and `--model` together. Interim: write/run
  start resolve the outer order from machine config only, no CLI override
  ([`write-behavior.md`](write-behavior.md)). Details:
  [`agent-model-config.md`](agent-model-config.md).
- **Local model is the terminal quota fallback.** When every paid CLI/platform in
  the agent fallback order is quota-exhausted, a locally-run model is the last
  resort rather than v1's hard exit `2` ("all agents quota-exhausted"). It sits at
  the end of the agent fallback order, configured only on machines that have it.
  Lifecycle and reach are settled under [Concurrency & memory budget → Local model](#local-model):
  Ollama server resident, qwen on-demand, reached via opencode.
- **Focused show/edit.** Shipped machine-agent CLI: `jarvis config show`, `jarvis config path`, `jarvis config set-agents <agent,agent,...>` on `~/.jarvis/config.json`. Per-project workflow drill-down deferred to [`agent-model-config.md`](agent-model-config.md).
- **Config-vs-source validation.** Because workflows are source and bindings are
  data, ship a check (companion to the workflow helper) that validates a
  project's config against the workflows it opts into — flags unknown workflow
  names, unknown step IDs, unknown agent/model values, and any missing
  role/agent assignment in the role→model store (the hard-error-at-load rule).
  This is what makes "build workflows as they come" safe: a new workflow tells
  each project what, if anything, it must configure.

### Review-debate

The **review-debate** behavior is a structured debate, not N identical critique passes
(the shape designed in `v2/spec/2026-06-07T19-57-26Z-review-debate`):

- **Read-only reviewers → a writing actuator.** One cycle is three read-only
  reviewer roles — adversary → advocate → adjudicator — then a separate actuator. The
  adjudicator emits a **verdict**: an outcome-altitude instruction (what must be true and
  why, never the diff). The actuator is the *only* writer; for implement it updates
  implementation files, while for plan it updates the generated spec tree from a
  review-actuator prompt. Intent refinement remains a separate pre-draft behavior.
- **This is why roles matter.** Reviewers bind **`adversary`**, **`advocate`**, and
  **`adjudicator`** — read-only debate roles with critique-appropriate models; the
  actuator binds **`actuator`** and is the only writer (implement context →
  implementation files; plan context → spec tree). Plan authoring steps elsewhere
  bind **`plan`**; implement write-loop steps bind **`implement`**. The split that
  matters is reviewers ≠ actuator with different models, not that the actuator is
  always "cheap." One role would force one model to do both — the conflation the
  agent/model split above exists to avoid. Splitting adjudicator from actuator also
  stops a reviewer grading its own fix, and lets the actuator's diff re-enter the
  next cycle's debate. See [`role-resolution.md`](role-resolution.md).
- **Verdict lives next to the spec**, distinct plan/patch filenames, overwritten
  each cycle (full trail in git). Empty verdict → no actuator run. Default is one
  cycle; the harness adjudicates no materiality — nothing to find means an empty
  verdict, not a convergence gate.
- **Live progress surfaces through the daemon `list`/TUI snapshot.** A review-debate
  step gets one row (keyed by `stepId`, not one per role); while a cycle runs, the
  row's role tracks the currently-executing adversary/advocate/adjudicator/actuator,
  then holds the terminal role and outcome once it completes or stops. Tracked
  in-memory only — no durable per-role run rows.

### Output contract (step outcomes)

What gives the runner permission to advance, retry, or stop at each step. The
model is **asymmetric "both"**: the agent emits a cheap structured outcome token,
and the runner **deterministically** verifies an artifact contract before
trusting a finish. No second agent call is spent verifying completion unless a
workflow explicitly adds a review step.

Outcome tokens:

- **`progress`** — did useful work, not finished. Runner loops again, consuming
  one of the loop's `N` max. The contract is **not** checked.
- **`done`** — claims finished. Runner verifies the contract → pass advances,
  fail adds a `## Blocker`.
- **`no-work`** — nothing left to do. Contract handling matches `done`:
  pass advances, fail blocks. It remains a distinct durable outcome
  classification rather than collapsing into `done`.
- **`blocked`** — agent declares it's blocked. Never counts as `done`; runner
  stops and surfaces the run to the operator.

Rules:

- **Contract is per-step.** Each step declares its own expected artifacts in the
  workflow source (files exist, boxes moved, parse/schema valid, write boundary
  respected, clean tree — exact primitive vocabulary still to design).
- **Contracts are deterministic — never spawn an agent.** This is the cost
  constraint: verification is free, so it can run freely.
- **Checked only on terminal outcomes (`done` / `no-work`), never on `progress`.**
  Don't block mid-loop — an agent may still clean things up on a
  later iteration. A deterministic check is cheap, but checking mid-loop would
  block on artifacts that legitimately don't exist yet.
- **Mismatch → blocker, not silent retry.** Agent says terminal but the contract
  fails ⇒ add a blocker and stop, rather than quietly looping again.
- **Budget exhausted while still `progress` → soft stop**, matching v1's
  max-iterations (exit `5`): resumable, not a blocker.

To design later: the contract primitive vocabulary. A blocker surfaces as a
`blocked` run the operator inspects and re-runs.

### Interface

- **Daemon-first.** A persistent daemon owns run state and exposes a programmatic
  API from day one; the CLI, TUI, and any future web UI are thin clients over it.
  This kills the multi-window problem immediately (runs detach from terminals)
  and means orchestration logic is never rebuilt to add a surface. Matches the
  vision's "embeddable, not a one-shot CLI lifecycle."
- **TUI is the first UI client.** A terminal dashboard to launch / monitor /
  steer runs, with a separate server window streaming logs alongside it. Lighter
  on memory than a web UI (matters with concurrent agents + the local model) and
  works over SSH to the work machine without port-forwarding. Richer clients
  (web) can be added later over the same API.
- **Shipped TUI (`jarvis tui`).** Discovers all live daemon sockets, connects to
  each, proves liveness via IPC `health` and IPC `status` on all (`{ state: "running" }`),
  then aggregates their daemon `list` results into one monitor: each run ID is deduped
  (the daemon reporting `isLive` is the owner), and a connection that fails to list is
  skipped without aborting the view. Steering RPCs (`pause` / `resume` / `kill`)
  route to the owning daemon. When no sockets are discovered, the monitor connects
  only to the invoking digest's socket and behaves as before (single-daemon view).
  `jarvis run list` and `jarvis run wait` remain single-daemon. Optional workflow-step
  snapshots on `list` rows (see [`daemon-host.md`](./daemon-host.md#list));
  operator contract: [`write-behavior.md`](./write-behavior.md#tui-cli). Queued runs
  (`status: "queued"`) render under a separate "Queue" heading, oldest-queued-first,
  each showing a fixed "waiting: memory headroom" descriptor in place of liveness;
  the "Runs" section (non-queued) always renders. Queued runs are excluded from
  selection (`selectRun`, initial pick, navigation, and the selection-loss
  fallback) since they carry no steering RPCs. Down/`j` and Up move selection;
  `k` remains kill rather than an up binding, preserving the established
  steering key.
- **Shipped TUI log follow (`jarvis tui log <run-id>`).** Separate ink session
  over the same production socket: IPC tail replay plus live follow for one run;
  operator contract:
  [`write-behavior.md`](./write-behavior.md#tui-cli). Dashboard launch/monitor/steer
  and aspirational multi-window log layout remain sibling work.
- **Observability log stream.** Structured event log (`iteration_started`,
  `boundary_committed`, `loop_finished`) keyed by run ID, queryable by sink +
  reader interfaces. Appended directly by the write loop; not part of the
  orchestration store. Each run's `seq` is unique and monotonic across
  concurrent writers on the same log file; allocation reads the durable log at
  append time (synchronous read → next seq → write). Consumers query via `tail`
  (snapshot of persisted events) or `follow` (replay from seq 1, then stream new
  events until aborted). See `persistence/log-stream.ts` for inline contracts.
- **Entry is explicit workflow selection.** A run starts by naming a workflow +
  target over the API/CLI. A natural-language prompt router — `jarvis "<intent>"`
  that classifies free text and routes to a workflow (new run) or an existing run
  (resume), conservatively asking for a sharper prompt when unsure — is a later
  thin client over this same surface (the last open roadmap item,
  [`v2-meta-index.md`](../spec/v2-meta-index.md)), not part of
  the core entry contract.
- **Ink and Yoga layout loading boundary.** All dynamic imports of the `ink`
  package and its Yoga-layout dependency happen through a single lazy boundary,
  `loadInkUi()` in `tui-ink-runtime.ts`. This boundary centralizes the TDZ (temporal
  dead zone) workaround for Bun's initialization order and ensures Yoga layout is
  initialized exactly once per session. No file in `v2/src/tui/` imports `ink`
  directly (static import, `require()`, re-export, or competing dynamic call site);
  all TUI components load ink-derived values through `loadInkUi`. Test seams inject
  a mock render function via the `inkRender` parameter; production paths receive
  real `ink` / Yoga state from the shared boundary.

Steering (the API surface the TUI drives):

- **Scope is pause / resume / kill.** That's the steering vocabulary to build
  now. Anything richer — edit a spec mid-run, inject a message, reorder steps —
  is guessing the future; defer until a real need shows up.

Observability (log follow interface):

- **`follow` replays from the beginning, then streams new.** The reader iterates
  all persisted events from seq 1 onward, then blocks on a fixed `FOLLOW_POLL_MS`
  poll between `tail()` rescans — a detached `openLogReader` process receives live
  appends from a separate writer process after replay. No offset/cursor API —
  consumers filter post-hoc via the `seq` field on `PersistedRecord`. Honour
  `AbortSignal` for clean shutdown. Daemon IPC tail inherits this via `follow`;
  mechanism detail pinned in `persistence/log-stream.ts`.
- **Tail is served over the IPC stream.** Clients open a multiplexed stream with
  `stream-open` carrying the run ID in the payload. The daemon backs the stream
  with the log reader's `follow(runId, signal)`, replaying persisted records,
  then streaming new appends. Each record is serialized as JSON and sent as one
  `stream-data` frame. The stream closes when the client sends `stream-end` or
  disconnects.
- **`wait` blocks on the next invocation boundary.** The run-control RPC
  validates and loads the run, captures the current tail `seq` as a subscribe
  cursor, then waits on `follow(runId, signal)` for the next `loop_finished` or
  `run_execution_failed` with a greater `seq`. Durable `runStatus` is re-read at
  resolve time. Already quiescent runs (`runStatus !== "in-progress"`) return
  immediately from durable state plus the last terminal log signal. Operator
  CLI: `jarvis run wait <run-id>` invokes this RPC; see
  [`write-behavior.md`](./write-behavior.md#wait-exit-codes).
- **Waiters are detached clients, not run owners.** Multiple waiters for the
  same run share one terminal fan-out and all receive the same payload at the
  terminal edge. Disconnecting one socket aborts only that waiter: the run and
  other waiters continue. `wait` is a long-running RPC response on the original
  request `id`; other RPCs on the same connection remain usable while it is
  pending.

## Runs & state

The daemon-first decision needs a durable run model under it. The governing
split: **the daemon owns *orchestration* state, never the *work* itself.** The
work product lives where it always has — git worktree, branch, spec files, PR.
The daemon stores only the position and bookkeeping needed to drive and resume a
workflow, so a run stays recoverable and inspectable even when the daemon is
down.

A **run** is a workflow instance carrying:

- **Identity** — run ID, target project, workflow name, spec/target ref, created-at.
- **Status** — the closed `RunStatus` union in
  [`state-store.md`](state-store.md) (`in-progress`, `completed`, `blocked`,
  `budget-soft-stopped`, `paused`, `failed`, `killed`, `queued`).
  The write loop uses `paused` to record a graceful pause (last attempt committed at
  boundary); `killed` records an immediate abort by the daemon (last attempt may be
  uncommitted; prior iteration commits on the branch remain).
- **Checkpoint** — one durable pointer to the next stable workflow step ID (`next_step_id`).
- **Pointers to work** — worktree path, branch, spec path, PR. Not their contents.
- **History linkage** — execution history is not embedded on `runs`; it is stored
  as separate attempt and outcome rows linked to the run by durable IDs.

Durable split (target shape):

- **`runs`**: orchestration identity/lifecycle/checkpoint plus work pointers.
- **execution history**: per-step attempts and their outcomes as rows linked to
  the run by durable IDs — not a free-form JSON blob on `runs`, so runner
  branching reads closed outcome classifications rather than parsing payloads.

The exact columns are grown behind their consumers, not designed ahead of them:
the write loop's resume read defines the first attempt/outcome fields, the
workflow runner adds cross-step history. Payloads stay narrow and deterministic
(timestamps, terminal status, outcome classification, minimal branch fields);
transcript bodies, rich logs/events, daemon/session metadata, and token/cost
streams stay out of the orchestration store.

### Persistence

- **SQLite under `~/.jarvis/state/v2.sqlite` for orchestration state.**
  A library-owned bootstrap opens this file (or an explicit caller override for
  tests/temp stores) and applies forward-only, idempotent migrations before
  repository operations are exposed. The store is a host-agnostic library:
  correctness does not require daemon single-writer ownership, lock policy, or
  WAL — those are runtime tuning the daemon host can add later, not persistence
  prerequisites. The first durable rows appear when the write loop needs to
  resume; the store is not built before a consumer reads it.
- **Observability log stream stays separate from orchestration state.** The
  structured event log is a distinct injectable artifact, not persisted in
  `v2.sqlite`. Append/read/follow are stateless interfaces; log persistence is
  independent of run recovery.
- **Telemetry facts are a third persistence role.** Append-only analysis
  substrate (default `~/.jarvis/telemetry.jsonl`, injectable) — per-invocation
  usage/cost and boundary work facts keyed by `run_id` / `attempt_id` /
  `invocation_id`. Not used for recovery; not the observability log. Capture
  contract: [`telemetry-capture.md`](telemetry-capture.md).
- **Repository-style operations, no generic query layer.** The store exposes
  named operations at workflow boundaries (create a run, record a step start,
  commit a step boundary, load a run for resume, read step history) keyed by
  stable IDs — never a generic SQL surface. The exact method set and payloads are
  settled with the consumers that call them (the loop, then the runner), not
  specified ahead of them.
- **Single transactional completion boundary.** One write path persists attempt
  completion, outcome durability, and checkpoint advancement together — they
  commit or roll back as a unit, so a boundary is all-or-nothing.
- **Identifier-driven API contract.** Operations accept and return durable IDs so
  caller code never needs direct SQL addressing knowledge.
- **Internal-only implementation surfaces.** SQL text, row mappers, migration
  helpers, and raw DB access stay internal and are not public v2 contracts.
- **Chosen over Postgres deliberately.** Postgres is available and always-on on
  both machines, so memory/install weren't the deciding factor — keeping the
  daemon **hermetic** was. The tool whose job is reliability shouldn't gain a new
  failure mode by depending on an external service. Two machines = two daemons =
  separate state regardless, so Postgres bought no architectural advantage. The
  choice is not abstracted behind a swappable data layer (that would be
  speculative-flexibility source code).

### Recovery

- **Kill-resume == crash-recovery at the same boundary.** Both are the same
  recovery path: never resume mid-step; replay from the last durable pre-step
  boundary. The write loop is the first consumer to need this; the daemon host
  later invokes the same recovery through its IPC surface without redefining it.
- **Recovery derives from the orchestration store, not the observability log.**
  The resume key is `(project, branch)`. The next-step checkpoint on `runs` (or
  a terminal run status when nothing remains) plus the durable attempt/outcome
  history in the orchestration store determine where a run resumes. The
  observability log stream provides visibility, not recovery sourcing.
- **Worktree is reconstructible; the branch is durable.** The branch and its
  commits are the durable artifact in git; the worktree path is only a pointer.
  Resume recreates a missing worktree from its branch — carrying forward v1's
  auto-materialization (rebuild from the local branch, or `origin/<branch>` if
  only remote), which out-of-repo worktrees and a long-lived daemon make routine.
- **Idempotent boundary commit.** Because a boundary commits atomically (above),
  retrying a finished boundary must not advance the checkpoint twice or duplicate
  durable effect. The concrete recovery-read cases are settled with the loop and
  runner that consume them, not enumerated ahead of them.
- **Out of scope until a consumer needs it.** Mid-step snapshots, structured
  event history, and human-steering state are deferred until a concrete recovery
  read requires them.

### Steering semantics

- **Pause is graceful** — takes effect at the next step/iteration boundary (TUI
  shows "pausing…" until the current iteration finishes), so no work is lost.
  In the write loop, pause is a separate `pauseSignal` (AbortSignal) input,
  checked only at the iteration boundary after the step completes. If a step
  completes despite pause being signaled, the boundary commit is skipped so the
  loop doesn't race the daemon's status write.
- **Kill is immediate** — aborts the run's AbortSignal immediately, causing
  signal-honoring bindings to tear down their agent processes (SIGTERM→SIGKILL).
  **Kill may leave a dirty worktree** (in-flight step edits not yet committed);
  **committed per-iteration SHAs on the same branch survive** kill, daemon
  reconcile, and resume while the branch exists. The loop skips the boundary
  commit if a step returns after abort, so the daemon is the sole writer of
  `killed` status.
- **Resume branches on how the current step stopped.** Pause stopped
  *completed-at-boundary* (last attempt committed) → resume continues with a fresh
  attempt. Kill/crash stopped *interrupted* (last attempt still in-progress) →
  resume re-runs the interrupted step over the dirty worktree (same code path as
  crash recovery).

### Blocked runs pause for the operator

A **blocked** outcome (from the output contract) stops the run with its
worktree, branch, and spec intact. The operator inspects the spec and
uncommitted work, resolves the blocker, and re-runs — no blocker polling, no
brittle external resume conditions. (An in-workflow human-approval step with
approve/revise decisions shipped once and was deleted as unreachable, PR #1803;
steering is pause/resume/kill only.)

## Concurrency & memory budget

The unit is the **run**: workflows are linear, so a run has at most one agent
subprocess in flight at a time. Concurrency is therefore "how many runs execute
at once," and the heavy memory consumers are the active agent CLI subprocesses
and the local model.

- **Adaptive, memory-watermark admission.** A static count cap doesn't translate
  across machines (personal M5 with ~2× the memory vs. work M1) or across
  changing work intensity. Instead the daemon admits a queued run only while free
  memory stays above a **configurable floor** ("keep N GB / X% free"). The floor
  is the per-machine tunable and auto-scales to whatever's actually available at
  the moment. Measure at admission boundaries with a short **settle delay**
  between admissions (admit one, let it stabilize, re-measure) to avoid a
  thundering herd. An optional dumb max-count backstop can sit on top purely as a
  safety ceiling.
- **`queued` is a run status.** Runs admitted beyond current headroom queue and
  the daemon admits them FIFO as memory frees.
- **Admission-only, no preemption (v1).** The budget gates *new* admissions; it
  never touches already-running runs. Graceful preemption (pause the
  lowest-priority running run at its next boundary when memory goes critical,
  reusing the pause machinery) is noted as a future option, not built now.

### Local model

- **Ollama server always-on; model on-demand.** The always-on piece is the
  lightweight Ollama server. `qwen-3.6:35b` loads on demand into it, and Ollama's
  native `keep_alive` provides warm-TTL-then-unload — we don't build model
  lifecycle ourselves. This reconciles the constraints doc's "local model running
  at the same time": the *server* is resident, the *model* is not.
- **Reached via opencode, no new adapter.** The fallback calls the Ollama server
  through `opencode` (already in v1's roster), configured to point at ollama/qwen.
- **Configured only where it exists.** The local model is just a terminal entry
  in the agent order, present on the personal machine only. The work machine's
  order has no local fallback, so all-paid-exhausted stays a hard stop there (v1
  exit-2 behavior). This fits the per-project/agent-order config model.
- **No special concurrency weighting needed.** Because admission is memory-aware,
  a loaded qwen *is* the memory drop that throttles new admissions — the watermark
  handles it without any explicit "local-model run weighs more" rule.

## Git, worktrees & PRs

Most of v1's git/GitHub machinery is sound and carries forward unchanged:
harness-authored commits (not agent git automation), `Spec:`-line + embedded
acceptance-criteria commit bodies, `index.md` checkbox flips, `Jarvis-Agent`
trailers + the PR attribution footer, idempotent draft-PR creation (OPEN-only),
narrative-marker body rewrites, two-phase push, base branch via `gh`, the `gh
auth` preflight, and the git toggle (global + per-project, incl. git:false
loop-only runs). What the long-lived daemon and the "no artifacts in target
repos" principle change is smaller:

- **Worktrees live outside the repo.** v1 puts them at in-repo `.worktree/<name>`.
  v2 moves them to `~/.jarvis/worktrees/<project>/<branch>/` as linked worktrees.
  Git supports worktrees anywhere; the only in-repo trace is `.git/worktrees/<id>`
  metadata, invisible in normal diffs, so the working tree stays pristine. This
  extends the same no-artifacts reasoning that drove config out of target repos —
  it matters most on work repos where coworkers don't want personal artifacts.
- **Locking suits a single daemon.** The daemon is the sole orchestrator, so for
  its own runs it tracks worktree ownership in-memory — no two runs share a
  worktree, no PID-lock dance among daemon runs. The on-disk `.jarvis.lock` stays
  for **cross-process coexistence** (`jarvis1`, your editor, manual git). The lock
  is held for the **whole run lifetime, including while paused** — the worktree
  is "checked out" to that run until done or killed.
- **Git/PR lifecycle is runner-owned, not composable.** Commits/PRs are baked into
  the runner, keyed off behavior type, rather than exposed as composable steps
  (that would be flexibility for its own sake). Write/review behaviors that mutate
  the repo produce harness commits; the draft PR opens when the first commit
  lands and refreshes as the run progresses; completion finalization flips the
  draft PR ready after a green gate (the operator merges). Workflows don't
  micromanage git.
- **Concurrency guards fall out.** At most **one active run per (project,
  branch)** — concurrent runs on different specs are fine (different worktrees),
  same branch is not. And **git:false (loop-only) runs can't run concurrently on
  the same root** — no worktree means no isolation, so they'd clobber each other
  (v1 never hit this because it was one-shot).
- **Async Git on daemon runs.** Worktree setup on daemon-reachable write paths is
  awaited through `AsyncSubprocessRunner` so Git yields to the event loop.
  Validation (branch existence, worktree checks, current branch), worktree
  creation, pruning, and common-dir resolution preserve output encoding, error
  handling, and sequential setup/cleanup order. Workflow shrink changed-file
  discovery, patch-review diff rendering, review-enforcement status/checkout/clean,
  and intent-output change detection plus ownership lookup (`git status`, `git diff`,
  `rev-parse --git-dir`), plus completion-commit Git and PR-attribution footer rendering
  (`git log`, index staging via `GIT_INDEX_FILE`, `commit-tree`, `update-ref`), plus
  completion publication (upstream detection, `git push`, `git rev-parse HEAD`,
  `gh pr list`/`create`, `gh pr view`/`edit`), are awaited (including `maxBuffer` and ignored
  stdio where applicable). Ready finalization remains synchronous on its own conversion slice.
  See [`write-behavior.md`](./write-behavior.md) for publication ordering, retries, and failures.
  Reviewed plan landing owns `verdict-plan.md` at the durable spec boundary;
  reviewed implementation's shared completion snapshot owns adjacent
  `verdict-patch.md`. Both preserve final-cycle bytes, including empty verdicts.
- **Unrelated IPC during pending run Git.** While a daemon-hosted run awaits any of the
  Git/`gh` subprocesses above, unrelated RPCs (`list`, `health`, steering, `wait`, `tail`, …)
  still dispatch on the same event loop. `daemon-ipc-responsiveness-during-git.sandbox-unrunnable.test.ts`
  holds a representative `withExternalWorktree` Git command at a signaled pending state,
  proves `health` resolves before that command is released, then releases Git and completes
  the run.

## Interface & IPC

The daemon exposes a hermetic programmatic API over a Unix-domain-socket IPC
transport. All daemon control is async/await; there is no CLI here (CLI/TUI
surface is a sibling concern, wired via this interface).

- **IPC transport:** Length-prefixed JSON frames over Unix sockets. RPC methods
  (`health`, `status`, custom handlers) and multiplexed streams (log, workflow
  output). See [`daemon-host.md`](daemon-host.md) for frame shapes and semantics.
- **Lifecycle API:** Programmatic `startDaemon`, `stopDaemon`, `getDaemonStatus`
  in `daemon/daemon-lifecycle.ts`. Detached child process with bounded readiness
  timeout, graceful shutdown (RPC + SIGTERM + SIGKILL), and double-start
  protection. Production socket and PID defaults (`~/.jarvis/daemon.sock`,
  `~/.jarvis/daemon.pid`) are pinned by the CLI and [`jarvis tui`](./write-behavior.md#tui-cli);
  the lifecycle library still requires explicit paths from callers.
- **In-memory worktree ownership:** Daemon holds a registry keyed by `{project,
  branch}` (the state-store resume key), recording `{runId, worktreePath}`.
  `claim` rejects double-claim; `release` is idempotent. No disk writes or
  PID-lock coordination — the on-disk `.jarvis.lock` and git worktrees locking
  remain for cross-process coexistence (daemon runs vs. `jarvis1`, editors, manual
  git). The lock is held for the whole run lifetime; ownership ensures no two
  daemon runs touch the same worktree.
- **Client trusts daemon response shapes.** Client and daemon are the same
  build talking over a local Unix socket — no cross-version protocol skew is
  possible. `daemon/daemon-wire.ts` parsers are envelope-thin: they confirm the
  result object is present and route it into its typed result (e.g. `runs` is
  an array) without re-validating per-row/per-field contents, then cast.
  CLI command handlers (`v2/src/cli.ts`) consume these parse results
  directly, with no additional per-field re-validation of their own.
  Daemon-side request validation is untouched. Future wire additions should
  not reintroduce per-field client-side validators.

## Orchestration API

Run orchestration verbs over the daemon's IPC interface:

- **`start(input: WriteLoopInput): {runId}`** — Spawn a write loop in the
  background and return its run ID immediately (the RPC response does not wait
  for loop completion). Gated by two admission guards: (1) at most one in-flight
  run globally; (2) no overlapping runs for the same `{project, branch}`. Both
  rejections use the `error` response kind.
- **`list(): {runs: Array<{runId, project, branch, status, isLive}>}`** — List
  all durable run rows merged with in-memory liveness. A run's `isLive=true`
  only while its loop Promise is executing. Allows a client to distinguish a live
  run from a crashed daemon's stale row — the canonical use case for
  durable-plus-liveness merge.
- **`wait({runId}): {runStatus, loopOutcomeKind?, iterationsConsumed?,
  resumable?}`** — Long-running one-shot RPC for a run's next invocation
  boundary. In-progress runs resolve on the next terminal log signal after the
  subscribe cursor; quiescent runs resolve immediately. `loop_finished` supplies
  loop fields; `run_execution_failed` or durable terminal rows without
  `loop_finished` return durable `runStatus` only.
- **Daemon-owned run-execution failure capture:** When the spawn-boundary
  `writeLoopExecutor` rejects outside normal loop settlement, the factory
  best-effort persists durable `status: "failed"` (skipped when status is already
  terminal), awaits a required `failureReporter` with the original rejection value,
  appends one `run_execution_failed` log event via the production reporter, then
  releases in-memory worktree ownership. Does not call `commitCompletionBoundary`;
  latest attempt may remain `in-progress`. See [`daemon-host.md`](daemon-host.md)
  for capture order and operator shape after failure.

## Constraints & guiding principles

The constraints and guiding principles that govern this architecture — cost,
memory, configurability, composability, extendibility, reliability; terseness,
capped PR size, strong architectural decisions — are the canonical list in
[`v2-vision.md`](v2-vision.md). They are not duplicated here, to avoid drift; this
doc is checked against them.
