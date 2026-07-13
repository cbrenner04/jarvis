# Agents

Reference for the agent CLIs jarvis can invoke, the flags it passes, and the
permission posture it enforces.

See also: [Operator Runbook](./operator-runbook.md) for recurring session patterns (background-run-and-poll, branch discipline, manual finalization, sandbox blindness, and admin-merge workflow).

## Supported agents

Jarvis shells out to one underlying agent CLI per iteration. Supported agents
and the binary each one invokes:

| Agent | CLI invoked | Notes |
| --- | --- | --- |
| `claude` | `claude -p --permission-mode acceptEdits --output-format stream-json --verbose` | Prompt is piped on stdin (non-interactive print mode); `--permission-mode acceptEdits` auto-allows file edits and safe filesystem commands without prompting (`claude --help`); `--output-format stream-json --verbose` streams NDJSON events during the iteration so the idle-output watchdog sees liveness, while jarvis displays the parsed terminal `result` text and extracts Claude-reported token usage and cost. Jarvis appends `--add-dir <path>` for each configured project sibling and external spec directory. |
| `codex` | `codex exec --color never --sandbox workspace-write -c approval_policy="on-request"` | Prompt is piped on stdin; `--color never` disables ANSI for log-friendly text; `--sandbox workspace-write` allows writes inside the workspace and blocks network and out-of-workspace writes; `-c approval_policy="on-request"` pins approval behavior through Codex's config override channel (`codex exec --help`). Jarvis appends `--add-dir <path>` for each configured project sibling and external spec directory. Token usage is **correlated from session JSONL** under `~/.codex/sessions/`: Jarvis appends a unique HTML comment marker to each prompt, snapshots session files before the invocation, and only records usage when exactly one changed session file matches that marker (and cwd metadata when present). Ambiguous or missing correlation is recorded as `usage_source: "unavailable"` rather than guessing. **Codex `input_tokens` is normalized to fresh-only before costing**: OpenAI reports `input_tokens` inclusive of `cached_input_tokens`, but jarvis normalizes `input_tokens = max(0, input - cached)` to match the disjoint-bucket convention `computeCost` assumes, preventing double-billing of cached tokens. |
| `cursor` | `cursor agent -p --output-format text --force --workspace <cwd> "<prompt>"` | Headless print mode; `--force` enables file writes in print mode; `--output-format text` matches transcript shape of other agents; prompt is the trailing positional argument (`cursor agent --help`). Although Cursor exposes JSON and stream JSON transcript formats, token usage is not currently exposed in a stable machine-readable field for jarvis extraction, so successful cursor iterations record `usage_source: "unavailable"`. When project siblings are configured, their paths are listed in the prompt as part of the allowed project workspace, allowing Cursor to reason about cross-repo work. |
| `opencode` | `opencode run --dir <cwd> --model <provider/model> --format json <prompt>` | Uses OpenCode Zen (`opencode/deepseek-v4-flash-free`) by default. `--dir` is set to the working directory for the run; `--model` is required and read from the opencode entry's `model` field in `modes.patch.agentOrder`; `--format json` causes opencode to emit one JSON object per line to stdout, including token usage and cost data; prompt is the trailing positional argument. Jarvis extracts usage from `step_finish.part.tokens` and `step_finish.part.cost` fields in the JSON stream for successful opencode iterations, recording `usage_source: "agent"` and `cost_source: "agent"`. When no complete `step_finish` events are present in the stream, the run falls back to the legacy token estimator path (`usage_source: "estimated"`) and generates a per-iteration warning. Permissions are configured via `~/.config/opencode/opencode.json` rather than a CLI flag — see [Opencode setup](#opencode-setup). When project siblings are configured, their paths are listed in the prompt as part of the allowed project workspace, allowing Opencode to reason about cross-repo work. |

The default fallback order is `claude → codex → cursor`. `opencode` is
supported but **opt-in** — it is not in the default
`agentOrder`. Change the order with `jarvis1 config set-order <a,b,c>` (see
[config.md](./config.md)).
Quota detection is per-agent and based on documented or observed stderr
signals; see [quota-signals.md](./quota-signals.md).

### agentOrder as an escalation ladder

`modes.patch.agentOrder` is an escalation ladder: when an agent hits quota, makes no progress, or stalls on idle output during patch implementation, the harness shifts it off the front of `activeAgents` and retries the same subspec with the next agent. The intent is to order entries cheap→strong so cheap actuators run first and stronger (more expensive) models are reached only when needed.

- **Quota escalation**: on a quota-classified result, the current agent is shifted and the next agent takes over immediately.
- **No-progress escalation**: on a successful iteration that ticked no new acceptance criteria and changed no files, the current agent is shifted and the next entry retries the same subspec at the next iteration number. The advance emits `<agent>: no progress; escalating to next agent` to stderr — distinct from the quota-fallback line.
- **Idle-timeout escalation (patch implementation, review actuator, and shrink)**: when the idle-output watchdog fires and at least one later rung remains, the current agent is shifted and the next entry retries. Patch implementation uses `modes.patch.agentOrder`; review actuator and shrink use `modes.patch.subRoleAgentOrder.reviewActuator` (falling back to `modes.patch.agentOrder`). The advance emits `<agent>: idle timeout; escalating to next agent` (review actuator prefixes with `review:`; shrink prefixes with `shrink:`). Patch implementation returns exit `8` with `watchdog-idle-timeout` only after the final rung stalls (or on fix-up iterations, which do not escalate). Review actuator terminal idle exits `11` (`review-incomplete`). Shrink terminal idle exits `8`. Plan, review debate, and wall-clock timeouts stay terminal with no cascade.
- **Terminal stop**: exit 4 (`no-progress`) is returned only after the last ladder rung also makes no progress (or `maxIterations` is reached first, since each advance increments the iteration counter). The bounded tail, "stopping" message, and unticked-criteria diagnostic print only on this terminal stop.
- **Shared ladder**: quota, no-progress, and idle-timeout signals consume the same `activeAgents` list. A quota on one rung followed by an idle stall on the next each shift one entry; all three signals share the finite ladder.
- **Run-wide**: once shifted, the actuator stays escalated for all subsequent subspecs in the run (identical to quota-fallback semantics).

Each `agentOrder` entry couples an **agent CLI** with a **model**; advancing the ladder changes both simultaneously.

Patch runs can also start partway up this ladder via runnable-spec `tier:` metadata or `jarvis1 run --tier ...`; the durable patch-only mapping rules live in [v2/docs/v1-behaviors.md#patch-mode-run-workflow](../v2/docs/v1-behaviors.md#patch-mode-run-workflow).

### Per-run `--agent` override

Repeatable `--agent <name>[:<model>]` on `jarvis1 run`, `jarvis1 plan`, or `jarvis1 intent` replaces the mode's in-memory `agentOrder` for that invocation; `~/.jarvis/config.json` is unchanged. Omitted `:model` inherits from the configured entry for that agent; no matching entry exits non-zero before spawn.

**`jarvis1 run`** — replaces `modes.patch.agentOrder` for implementation iterations (quota, no-progress, idle-timeout, `--tier`, and `prNarrative: "agent"`). Review panel, review actuator, and shrink stay on pre-override config. `--resume-review` does not use `--agent` for implementation.

**`jarvis1 plan`** — replaces `modes.plan.agentOrder` for actuators (draft, verdict-actuator, PR narrative). Review panel and quota use pre-override `modes.review.agentOrder ?? modes.plan.agentOrder`. `--resume` + `--agent` applies override to verdict-actuator only.

**`jarvis1 intent`** — replaces `modes.plan.agentOrder` for intent-split actuation only.

**`jarvis1 prompt`** — single `--agent <name>[:<model>]` pins the primary agent for one invocation; remaining `modes.prompt.agentOrder` entries follow in config order with duplicates skipped. Optional `--model` applies when `--agent` omits `:model`; colon form wins when both are set. Model resolution: `--agent <name>:<model>` → `--model` → matching `modes.prompt.agentOrder` row → agent default. Config on disk is unchanged.

```sh
jarvis1 run --agent codex:gpt-5.4 path/to/spec/index.md
jarvis1 run --agent codex --agent claude:haiku path/to/spec/index.md
jarvis1 plan --agent codex:gpt-5.4 path/to/ready-intents/my-feature.md
jarvis1 intent --agent codex:gpt-5.4 path/to/seeds/my-seed.md
jarvis1 prompt --agent opencode:opencode/glm-5.2 "explain this module"
```

Jarvis normalizes the `PWD` environment variable for every spawned agent so
that agents that read `PWD` (e.g., opencode) operate on the working directory
(worktree or project root) rather than inheriting the harness's `PWD`.

### Orphan reaping

Jarvis does not tag agent spawns with any extra environment variable. To clean
up descendants that escape the process-group kill (e.g. a tool that calls
`POSIX::setsid()` and re-parents to init), the harness instead tracks an agent's
descendant PIDs while it runs and SIGKILLs survivors at iteration end and
finalize. Discovery uses only the `pid`/`ppid`/`pgid`/start-time columns of a
process listing — never process environments or command arguments — so nothing
about scanned processes is logged or stored. See
[run-loop.md#orphan-process-reaping](./run-loop.md#orphan-process-reaping)
for mechanics and rationale.

This is unrelated to the prompt-appended HTML-comment marker that `codex` uses
for session/usage correlation, which is a prompt artifact, not a process tag.

## Agent attribution labels

Each agent exposes an `attributionLabel()` method that returns a human-readable
identifier for its configured model. This label appears in the draft PR body
footer to record which agent and model produced the work.

The label format varies per agent:

- **Known model IDs**: Mapped to family+version labels (e.g.
  `claude-opus-4-8` → `Claude Opus 4.8`).
- **Unknown model IDs**: The raw model string is returned.
- **No model configured** (agent using its default): Returns
  `<cli-name> (default model)` (e.g. `claude (default model)`).

Each agent maintains its own internal map of known model IDs, allowing the
mapping to grow independently as new models land. The map is not shared or
centralized because each agent already owns the relationship between its CLI
and the model strings that CLI accepts.

## CLI verbosity defaults

Jarvis does not strip or rewrite agent transcripts; it delegates presentation
to each upstream CLI. Current defaults:

- **Claude**: `--output-format stream-json --verbose` with `-p` — streams NDJSON
  events during the iteration so the idle-output watchdog sees liveness; jarvis
  displays the parsed terminal `result` text and extracts token/cost metadata
  from that event. `--verbose` is required by the Claude CLI for stream-json in
  print mode; the transcript is a liveness signal, not operator-facing log.
- **Codex**: `--color never` — removes escape codes so logs resemble the
  other agents' plain stdout.
- **Cursor**: `--output-format text` with `-p` — keeps logs readable because
  Cursor's JSON/stream modes do not expose stable usage metadata for jarvis.
- **Opencode**: `--format json` — emits JSON objects per line, including
  token usage and cost data that jarvis parses for cost attribution.

## Permission posture

Jarvis invokes agents with a `safe-edits` permission posture that allows:

- File reads and edits under the agent's working directory (the target repo
  root).
- Common read-only and safe filesystem operations: `mkdir`, `mv`, `cp`,
  read-only `git` (`status`, `log`, `diff`, `show`), etc.
- Prompt submission to the model within the agent's normal permission rules.

The posture **does not** allow without user confirmation:

- Network egress (`curl`, `wget`, package installs).
- Destructive commands targeting the filesystem root or home directory.
- Writes outside the target repository.

Jarvis **never** passes a provider's "bypass everything" or "dangerously skip
permissions" flags (e.g., `--dangerously-skip-permissions`,
`--force-allow-all`). Users who need to run an agent with fewer restrictions
should invoke the CLI directly. The rationale and per-provider implementation
are documented in [../spec/2026-05-11-permissions/](../spec/2026-05-11-permissions/).

## Opencode setup

Opencode is supported but opt-in: it is not included in the default
`modes.patch.agentOrder` or `modes.plan.agentOrder`, and its permission
posture is configured in opencode's own config file
(`~/.config/opencode/opencode.json`) rather than via a CLI flag.

The default opencode model is `opencode/deepseek-v4-flash-free` (OpenCode
Zen, free). Before selecting opencode, run the one-time permission installer
from the jarvis checkout:

```sh
bun run install-opencode-permissions
```

That command writes the `safe-edits` permission posture to
`~/.config/opencode/opencode.json` without changing unrelated opencode
settings.

Then edit `~/.jarvis/config.json` to add an opencode entry to either
`modes.patch.agentOrder` or `modes.plan.agentOrder` (or both) with a
configured `provider/model` string as its `model`:

```json
{
  "modes": {
    "patch": {
      "agentOrder": [
        { "agent": "opencode", "model": "opencode/deepseek-v4-flash-free" },
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.4" },
        { "agent": "cursor", "model": "Composer 2.5" }
      ]
    }
  }
}
```

The provider prefix is the opencode provider name, and the suffix is the
model name configured for that provider. For example,
`opencode/deepseek-v4-flash-free` routes through the `opencode` (Zen)
provider, while `github-copilot/claude-opus-4.8` routes through the
`github-copilot` provider. Providers are not separate jarvis agents; they
are selected only through the opencode entry's `model` value.

## Plan-mode prompts

Plan mode (`jarvis1 plan`) uses the same agent contract as patch mode. Plan-mode
prompts live in `prompts/plan/` (`refine.md`, `name-only.md`,
`draft.md`, `review.md`, `inline-draft.md`) and are short, focused prompts that
inject intent and guidance without requiring any non-default permission-posture
changes. The
refine phase is non-interactive intent refinement. The agent may inspect the
target repo and append planning notes, an
explicit skip, or a `## Blocker` to `intent.md`, but it cannot pause to ask the
terminal user questions. The same agents configured in `modes.plan.agentOrder`
can serve both patch and plan work.

Patch/plan prompt maintenance uses a metadata-first registry contract described
in [prompt-governance.md](./prompt-governance.md). Runtime lookup is by stable
prompt `id`, while prompt file paths remain organizational detail. The first
rollout includes shared `global.documentation`, `global.naming`, and
`global.terse` fragments plus `patch.prompt.body`, `patch.rules`, and plan
`draft`/`review`/`refine` prompts; `name-only` and `inline-draft` remain
outside that shared registry in this stage.

## Prompt ownership (relocation stage one)

Relocation stage one moved seven editable prompt text artifacts into the
repo-level `prompts/` tree:

- Patch mode stable instruction text: `prompts/patch/instructions.md`
- Patch mode rules text: `prompts/patch/rules.md`
- Plan templates: `prompts/plan/refine.md`, `prompts/plan/name-only.md`,
  `prompts/plan/draft.md`, `prompts/plan/review.md`,
  `prompts/plan/inline-draft.md`

The corresponding `v1/src/...` files now own loader/runtime behavior only
(path loading, interpolation, and rendering flow), not editable prompt-body
source text.

This relocation stage moved source files only. Subsequent prompt-governance
work introduced registry metadata, revisioned snapshots, and shared
`global.documentation`, `global.naming`, and `global.terse` fragments layered
into assembled agent-facing prompts.
Interactive/operator prompt surfaces such as repository
disambiguation remain in runtime code and are explicitly out of scope for this
stage.

## Plan invocation architecture

Plan mode single-call phases (draft, intent-draft, name-only, and future
review/shrink phases) route agent spawns and quota classification through a
shared executor (`shared/invocation/execute.ts`). Each phase creates v1-owned
invocation bindings that wrap agents and handle spawn + classification together:

- The binding factory (`createPlanInvocationBinding`) closes over per-consumer
  parameters: stderr emitter, telemetry sink, spawn options (e.g.
  `additionalReadDirs` for no-commit specs), pre-spin hooks (e.g. intent-split's
  stage directory reset), and advance predicates (draft, intent-split, and
  dormant `name-only` advance on `quota`, hard `error`, and `model_config`;
  review/patch keep terminal `model_config`).
- The shared executor loops through bindings, advancing to the next only when the
  binding's advance predicate returns true (default: `result.kind === "quota"`).
- Git porcelain snapshots and classification happen inside the binding's
  `invoke()` method; the executor and binding stay generic over
  `InvocationResult` subtypes and do not flatten rich results (e.g. cost/usage
  in ok results pass through unchanged).
- Per-attempt telemetry and spawn/classification plumbing are shared;
  advance/stop semantics remain phase-specific. Draft and intent-split rotate on
  `model_config` (rotation stderr via `emitPlanAgentQuotaFallback` with `plan:` /
  `intent:` prefixes); chain exhaustion still exits `3` via terminal handlers in
  `plan/run.ts` and `intent.ts`. Review, patch, and prompt keep fatal
  `model_config`. The `name-only` export shares the advance predicate but has no
  live operator path and no `model_config` rotation-stderr requirement.

## Patch invocation architecture

Patch mode's per-iteration loop retains its own advancement semantics (head
agent per iteration, with fallback on quota exhaustion). To align with the plan
binding architecture, patch now uses the shared v1-owned invocation binding for
spawn and classification — but keeps these as separate steps, not coupled inside
the binding's `invoke()` method:

- The binding factory (`createPatchInvocationBinding`) exposes `spawn` and
  `classify` methods. `spawn` runs the agent with watchdog integration
  (onSpawned, lastOutputAtMs, abortKillGraceMs). `classify` applies quota
  fallback with a guard thunk (computed after the iteration body).
- The patch iteration loop calls `binding.spawn()` to run the agent, then
  executes the iteration body (checking acceptance criteria, detecting edits,
  etc.), then calls `binding.classify(result, noIterationProgress)` with a guard
  computed from the iteration results.
- Patch keeps its own iteration-driven loop; it does not use the shared executor.
  Its per-iteration telemetry, stderr messages, and exit codes remain unchanged.
- The separable spawn/classify seam also serves other paths (review, shrink)
  that need custom logic between spawn and classification.

## Review/shrink model tiering

The jarvis patch and plan modes include read-only review roles (adversary,
advocate, adjudicator in patch review and plan self-review) plus code-writing
actuators (the review actuator that executes verdicts, and the shrink agent).
Agent order configuration lets operators assign faster, cheaper models to
read-only review roles while keeping stronger models on actuators.

**Agent order resolution by role:**

- Read-only review roles (adversary, advocate, adjudicator): resolve from
  `modes.patch.subRoleAgentOrder.reviewPanel` when set, else
  `modes.review.agentOrder` falling back to `modes.plan.agentOrder`.
- Patch implementation loop: resolves from
  `modes.patch.agentOrder` directly. Patch `tier:` / `--tier` slicing applies to
  this resolved ladder.
- Review actuator and shrink actuator: resolve from
  `modes.patch.subRoleAgentOrder.reviewActuator` when set, else
  `modes.patch.agentOrder`. The shared `reviewActuator` key governs both code-
  writing roles, but they consume it differently: verdict actuator quota and
  initial binding stay head-only (`reviewActuator[0]`); idle-output watchdog
  stall walks the full configured `reviewActuator` ladder (terminal stop on the
  final rung). Shrink keeps full-list quota fallback.
- `reviewActuator` tiers review actuator and shrink agents via
  `subRoleAgentOrder.reviewActuator`; unset uses full `modes.patch.agentOrder`.

This separation enables tiering: assign a fast/cheap reviewer tier to read-only
roles (e.g., Haiku or a smaller Codex variant) while keeping an
implementation-grade tier on the actuators (e.g., Opus or a larger model). The
fast reviewer tier provides quick defect signals, while the actuators get the
stronger models needed to fix code correctness issues.

**Tiering caveat:** Faster reviewer models trade defect-catch quality for speed.
Since reviewers produce the verdict that the actuator acts on, weaker reviewer
models may miss issues or produce lower-quality verdicts, placing heavier
burden on the actuator to recover. Evaluate reviewer model quality for your use
case before deploying a fast-only tier to production.

**Cross-mode coupling:** `modes.review.agentOrder` drives reviewers in both
patch-mode review and plan-mode self-review, so setting it to speed up patch
review simultaneously retunes plan-mode self-review. Patch-only
`subRoleAgentOrder.reviewPanel` overrides that shared order only inside
`jarvis1 run`; standalone `jarvis1 review` and plan-mode self-review keep using
the shared review resolution.

**Unset-default takeaway:** If `modes.plan.agentOrder` is already configured
with a cheaper model, setting `modes.review.agentOrder` is unnecessary —
reviewers already fall back to the plan order and inherit the tiering for
free. Explicitly set `modes.review.agentOrder` only when `modes.plan.agentOrder`
is expensive and you want cheaper reviewers in both patch and plan modes.
