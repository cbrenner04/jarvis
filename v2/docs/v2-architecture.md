# Jarvis v2 — Architecture

The decided v2 architecture, worked out through design interviews. Companion to
`v2-vision.md`: the vision owns the *why*, the rollout strategy, and the
constraints/guiding principles that govern the design; this doc owns the *how* —
the layered model, prompts, workflows, config, the execution model, and the
runtime. It reuses the behavior-loop vocabulary defined in the vision.

## The layered model

The smallest pieces of Jarvis split across four layers — two in source, two in
config. Naming them separately is what keeps the design from feeling tangled.

| Layer | Lives in | What it is |
| --- | --- | --- |
| **Behaviors** | source | Loop primitives: write, review-and-update, human. See `v2-vision.md`. |
| **Prompts** | source | Per-behavior prompts, rendered by layering fragments + per-step overrides. |
| **Workflows** | source | Named, linear-with-loops sequences of **steps** (behavior + prompt + output contract). No cli/model. |
| **Project config** | data (`~/.jarvis`) | Per project: which workflows are enabled, plus cli+model bindings over steps. |

**Terminology change.** The earlier framing of a "building block = prompt + agent" is retired.
The reusable source unit is a **step** (behavior + prompt + output contract).
The **agent (cli + model) is a per-project binding over a step**, not part of it.
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
snapshots). The canonical as-shipped contract is [`../../v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md);
[`prompts.md`](prompts.md) retains the original design intent.

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
- **Steps reference prompts, never cli/model.** The agent binding is config.
- **Authoring reuse via named step-groups.** A workflow can embed a reusable
  sub-sequence (e.g. `review-bundle` = code-review + security-review) so step
  lists aren't repeated across workflows. Keep nesting **shallow — one level, no recursion** —
  to avoid the workflow-graph explosion the vision warns against.
- **Steps have stable IDs.** Config maps step → agent, so bindings follow IDs,
  not positions; reordering or inserting steps must not silently re-target
  bindings.

Per-project config:

- **No Jarvis artifacts in target repos.** Jarvis is used on personal repos and
  at work where the setup isn't ours and personal artifacts aren't welcome. A
  project opts into workflows and configures cli+model entirely in `~/.jarvis`.
- **Default agent order + per-step override.** A project declares a default agent
  order (carried forward from v1's `agentOrder`); per-step config is an
  *optional* override. Most steps inherit the default; you only pin a model where
  it matters. This keeps config small and means adding a step in source doesn't
  silently leave every project's config incomplete.
- **A coarse default split for the common case.** The usual difference is
  planning/review (wants a robust, more expensive model — the work isn't spelled
  out yet) vs implementation (can use a cheap model — the spec already spells it
  out). Defaults should be tier-able along that split so the common case needs
  minimal per-step overrides: a "heavy" default for planning/review steps, a
  "cheap" default for implementation steps. Per-step overrides remain for the
  exceptions.
- **Per-step override is itself an ordered list** and defaults to the project's
  effective order, so v1 quota fallback composes unchanged — it operates on "the
  effective order for this step." Easy to accidentally design a per-step binding
  that drops quota fallback; don't.
- **Local model is the terminal quota fallback.** When every paid CLI/platform in
  the effective order is quota-exhausted, a locally-run model is the last resort
  rather than v1's hard exit `2` ("all agents quota-exhausted"). It sits at the
  end of the effective order, configured only on machines that have it. Lifecycle
  and reach are settled under [Concurrency & memory budget → Local model](#local-model):
  Ollama server resident, qwen on-demand, reached via aider.
- **Focused show/edit.** The config will be large. `jarvis config <project>`
  shows enabled workflows + only that project's overrides; `jarvis config
  <project> <workflow>` drills into one workflow's effective per-step agents
  (defaults shown, overrides highlighted). Mirrors v1's `prices show/edit`.
- **Config-vs-source validation.** Because workflows are source and bindings are
  data, ship a check (companion to the workflow helper) that validates a
  project's config against the workflows it opts into — flags unknown workflow
  names, unknown step IDs, unknown cli/model values. This is what makes "build
  workflows as they come" safe: a new workflow tells each project what, if
  anything, it must configure.

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
- **`no-work`** — nothing left to do. Treated as `done`: the contract still wins
  → pass advances, fail blocks. (Prevents an agent skipping required output by
  claiming there was nothing to do.)
- **`blocked`** — agent declares it's blocked. Never counts as `done`; runner
  stops and routes to a human loop.

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

To design later: the contract primitive vocabulary, and how a blocker surfaces in
a server/runner world (pause + route to a human loop vs. process exit).

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
- **Logs need improvement, but later.** Structured, queryable logging (per the
  vision) is the eventual target; the first cut can stream the existing log shape
  and improve from there.

Steering (the API surface the TUI drives):

- **Scope is pause / resume / kill.** That's the steering vocabulary to build
  now. Anything richer — edit a spec mid-run, inject a message, reorder steps —
  is guessing the future; defer until a real need shows up.

## Runs, state & the human loop

The daemon-first decision needs a durable run model under it. The governing
split: **the daemon owns *orchestration* state, never the *work* itself.** The
work product lives where it always has — git worktree, branch, spec files, PR.
The daemon stores only the position and bookkeeping needed to drive and resume a
workflow, so a run stays recoverable and inspectable even when the daemon is
down.

A **run** is a workflow instance carrying:

- **Identity** — run ID, target project, workflow name, spec/target ref, created-at.
- **Status** — running / paused / awaiting-human / blocked / completed / killed / failed.
- **Checkpoint** — one durable pointer to the next stable workflow step ID (`next_step_id`).
- **Pointers to work** — worktree path, branch, spec path, PR. Not their contents.
- **History linkage** — execution history is not embedded on `runs`; it is stored
  as separate `step_attempts` and `step_outcomes` rows linked by durable IDs.

Phase 1 durable split:

- **`runs`**: orchestration identity/lifecycle/checkpoint plus work pointers.
- **`step_attempts`**: per-step execution attempts keyed by durable `attempt_id`
  and monotonic `attempt_ordinal` per `run_id + step_id`.
- **`step_outcomes`**: separate durable outcome rows keyed from attempts (not a
  free-form attempt JSON payload), with closed classifications used by runner branching.

Phase 1 keeps payloads narrow and deterministic (timestamps, terminal status,
outcome classification, and minimal branch fields). Transcript bodies, rich
logs/events, daemon/session metadata, and token/cost streams are explicitly deferred.

### Persistence

- **SQLite under `~/.jarvis/state/v2.sqlite`.** Phase 1 is a pure library with a
  library-owned bootstrap path that opens this file (or an explicit caller
  override for tests/temp stores) and applies forward-only migrations
  idempotently before repository operations are exposed. Phase 1 correctness
  does not require WAL, singleton-writer daemon ownership, or daemon lock
  policy; those are optional runtime tuning details for later daemon phases.
- **Chosen over Postgres deliberately.** Postgres is available and always-on on
  both machines, so memory/install weren't the deciding factor — keeping the
  daemon **hermetic** was. The tool whose job is reliability shouldn't gain a new
  failure mode by depending on an external service. Two machines = two daemons =
  separate state regardless, so Postgres bought no architectural advantage. The
  choice is not abstracted behind a swappable data layer (that would be
  speculative-flexibility source code).

### Recovery

- **Checkpoint at step/iteration boundaries, not mid-step.** If the daemon
  crashes while an agent subprocess is in flight, on restart the interrupted step
  is re-run from the top. This works because of the output-contract model:
  re-running a finished step yields `no-work` + a passing contract → advance. v1
  already behaves this way iteration-to-iteration (the worktree holds partial
  work; the agent resumes from it). No mid-step checkpointing needed.

### Steering semantics

- **Pause is graceful** — takes effect at the next step/iteration boundary (TUI
  shows "pausing…" until the current iteration finishes), so no work is lost.
- **Kill is immediate** — SIGTERM→SIGKILL the agent process group, like v1's
  abort. **Kill leaves a dirty worktree**; killed runs are recovered or cleaned
  up, never cleanly continued.
- **Resume branches on how the current step stopped.** Pause stopped
  *completed-at-boundary* → resume just continues with the next step. Kill/crash
  stopped *interrupted* → resume re-runs the interrupted step over the dirty
  worktree (same code path as crash recovery). One field on the run records which.

### Human loop and "blocked" converge

Both are just "the run is paused awaiting a human." A **human-loop step** is a
*planned* pause; a **blocked** outcome (from the output contract) is an
*unplanned* one. They surface identically in the TUI and resume via the same
explicit API call — no blocker files, no polling, no brittle external resume
conditions (the thing the vision dislikes about v1). While paused, the worktree
is right there to edit, then resume.

Human-loop resume carries a decision:

- **approve** — advance to the next step.
- **revise** — repeat the configured step-range, consuming one of its `N`. This is
  what drives the bounded-repeat patterns in the vision ("repeat spec review +
  human review up to N times"). Revise accepts a dirty worktree and may carry a
  free-text prompt injected into the looped-back step (the "user input is injected
  into prompts purposefully" thread — the human loop is one injection point).
  **Validation: revise requires at least one of {dirty worktree, prompt}** — reject
  if neither, since with no edits and no instruction the agent would just redo the
  same thing.
- **abort** — kill the run.

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
- **Reached via aider, no new adapter.** The fallback calls the Ollama server
  through `aider` (already in v1's roster), configured to point at ollama/qwen.
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
  is held for the **whole run lifetime, including while paused/awaiting-human** —
  the worktree is "checked out" to that run until done or killed.
- **Git/PR lifecycle is runner-owned, not composable.** Commits/PRs are baked into
  the runner, keyed off behavior type, rather than exposed as composable steps
  (that would be flexibility for its own sake). Write/review behaviors that mutate
  the repo produce harness commits; the draft PR opens when the first commit
  lands and refreshes as the run progresses; a **human-merge step** triggers the
  ready/merge transition (v1's draft→ready). Workflows don't micromanage git.
- **Concurrency guards fall out.** At most **one active run per (project,
  branch)** — concurrent runs on different specs are fine (different worktrees),
  same branch is not. And **git:false (loop-only) runs can't run concurrently on
  the same root** — no worktree means no isolation, so they'd clobber each other
  (v1 never hit this because it was one-shot).

## Constraints & guiding principles

The constraints and guiding principles that govern this architecture — cost,
memory, configurability, composability, extendibility, reliability; terseness,
capped PR size, strong architectural decisions — are the canonical list in
[`v2-vision.md`](v2-vision.md). They are not duplicated here, to avoid drift; this
doc is checked against them.
