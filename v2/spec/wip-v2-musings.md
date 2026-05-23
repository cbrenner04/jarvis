# V2 Musings

Working notes for the v2 design. This complements `v2-vision.md`: the vision owns
the behavior-loop vocabulary and rollout strategy; this doc works out the
prompt / workflow / config layering and records what's decided vs still open.

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
  _overarching_ (global, e.g. terseness rules) and _behavior-specific_ (planning
  rules ≠ implementation rules). A rendered prompt = global fragments → behavior
  fragments → the step's task text, applied as a default layering. A step can
  **explicitly override** the default — add or remove specific fragments when
  it's the exception.

Still to design (owned by `v2-prompts.txt`): exact `prompts/` layout, fragment
taxonomy, the override syntax, and the rendered-prompt snapshot/behavior test
standard (a prompt edit can shift `jarvis1` output, so changes must be visible).

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
  _optional_ override. Most steps inherit the default; you only pin a model where
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
  end of the effective order. This is the "local model running at the same time"
  from the constraints; whether it stays resident or loads on fallback is a
  memory-vs-latency tradeoff to settle later.
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

## Constraints

### Cost Efficiency

We will need to be conscientious about cost. Some of the workflows can have many
agent interactions in it. We should be optimizing prompts, agent choices, and
orchestration to get the results we are looking for without unnecessary agent
use. If something can be deterministic, it should be.

### Memory Efficiency

Running agents takes up memory. There will also be a local model running at the
same time. We don't want our workflows bogging down the machine.

### Configurable

Much of what Jarvis does should have a data layer, part of which comes from
configuration. If it seems like it shouldn't be hardcoded in Jarvis, don't
ignore that - put it in the config.

### Composable

Not every project needs the same workflows. Some projects are very sensitive and
they need more human-in-the-loop blocks and more review blocks. Others can have a
"YOLO" posture. Even still, not every change needs a massive plan/review cycle -
even in a sensitive project.

### Extendible

Updates need to be easy to make and easy to review. This will make them more cost
effective but also improve our trust in them.

### Reliable

Testing will be important. Unit testing any business logic is a must. We should
have code coverage measured and blocking changes when dropped. We will need
integration testing. Workflows should be well covered with integration tests.
Finally, we are going to need evals. We want to know when our changes will result
in outcome drift, what that drift is, how big of an impact it has. Since this is
expense, they need to be on demand only and we need heuristics for when to run
them.

## Guiding Principles

### Be terse

This is a big one. It goes to cost effectiveness but also human review
effectiveness. LLMs can be verbose. We need to be clear that that is not what we
want. We want to be as terse as possible. If we can reduce the verbosity and keep
the outcomes very close to the same, we should always do that. This goes for
planning, implementation, and review. This applies in Jarvis source code as well
as target projects.

### Small PRs

PRs should be reviewable. That means <1000 lines touched. 600 is a sweet spot.
That means we have to be clear about being terse for every action an agent takes.

### Strong architectural decisions

Even if the user is in "YOLO" mode, the outcome should be based on well
considered architectural decisions. Nothing should be "just get it working". That
will just cause more iterations which won't be cost effective or terse.
