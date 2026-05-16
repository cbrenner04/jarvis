# Run loop

Reference for `jarvis run` semantics: how iterations are selected, how
completion is detected, where output goes, and how runs stop.

## Iteration

`jarvis run <spec-path>` resolves the requested spec to an absolute path and
reads it first. Jarvis then resolves which target repository to run against
using the following order:

1. `--repo <name|path|url>` flag — overrides everything below. The value
   may be a registered project name, an absolute path equal to a registered
   project's root, or a URL/slug that loose-matches a registered project's
   `origin`.
2. Spec `repo:` URL/slug — loose-matched against the `origin` URLs recorded
   for each registered project.
3. Spec path is inside a registered project's `root` — that project wins.
4. Spec path is inside any git checkout (walking parents until `.git`) — the
   run proceeds in ad-hoc mode against that checkout. Nothing is persisted
   to config.
5. Otherwise jarvis prompts to pick a registered project; in non-TTY runs it
   exits with a usage error.

Legacy short-circuit: when the spec `repo:` value is an absolute path that
equals a registered project's `root`, that project is used and steps 1-5 are
skipped. An absolute-path `repo:` that does not match any registered root is
silently ignored and the resolution flow above runs as if the line were
absent. No deprecation warning is printed in either case.

Jarvis uses the resolved path to prepare the per-spec
[worktree](./worktrees-and-commits.md) and as the base `cwd` for `gh`, git, and
the agent. The operator’s shell working directory may be outside any repository,
such as a parent directory of several clones. From that point, Jarvis runs
agents from `modes.patch.agentOrder` until the active spec has no unchecked boxes.

### Disambiguation prompt

When resolution is ambiguous or empty, jarvis falls back to an interactive
picker. Trigger conditions:

- The spec has no `repo:` line and is not inside any registered project or
  git checkout (step 5 above).
- The spec's `repo:` URL/slug loose-matches more than one registered project.
- `--repo <value>` was given and matches more than one registered project.

On a TTY (`process.stdin.isTTY === true`) jarvis prints a numbered list of
the candidate projects (name, root, origin or `(no origin)`) and reads one
line from stdin. Valid input is the index number, the project name, or
`q`/empty input/EOF to cancel. Cancelling exits 1 without invoking any
agent. A selection is used for the current run only and is never persisted
to config.

When stdin is not a TTY, jarvis does not prompt. It writes the candidate
list to stderr along with the suggestion to rerun with `--repo <name>` and
exits 1.

Normal runs use an `index.md` spec so agents select one indexed task per
invocation. When `<spec-path>` is not named `index.md`, jarvis prompts before
invoking any agent:

- `s` — switch to a sibling `index.md` and run the normal loop from there (only
  offered when a sibling `index.md` exists)
- `e` — exit without running an agent

Normal implementation work should run from `index.md`.

## Iteration banner

Each iteration prints a banner before agent invocation with:

- project key
- spec display name (containing directory name for `index.md` runs, file
  basename for direct non-index runs)
- iteration number
- current task excerpt (the first unchecked checkbox in document order, plus
  ordinal `1/N`, truncated to 140 chars)
- selected agent

Jarvis then builds the standard prompt and invokes the agent with `cwd` set to
the active worktree. The prompt asks the agent to discover target-repo
guidance and injects jarvis-owned rules from `src/modes/patch/rules.md` inline.

## Completion

Jarvis treats a spec as complete when the spec file has zero unchecked
GitHub-style task list items. An unchecked item is a line matching
`^\s*- \[ \]\s`; checked items use `- [x]` or `- [X]`.

When effective `git` is `true` and the agent `cwd` is a git checkout (normal
runs that use a worktree), Jarvis also requires a clean `git status` before
printing **spec complete**. That way checkbox completion cannot succeed while
changes are still only on disk. When effective `git` is `false`, the
clean-tree check is skipped: completion is purely "zero unchecked boxes",
regardless of dirty or untracked files in the agent's working directory.

A spec with no task list checkboxes is malformed. Jarvis fails fast instead of
treating it as complete.

### Completion output

On successful completion, the run terminal prints `spec complete` followed (on
the next line) by the URL of the draft PR, if one was opened. For example:

```
spec complete
https://github.com/example/repo/pull/42
```

If no PR was opened (e.g., the spec had zero unchecked boxes on the first
iteration so jarvis never made a subspec commit), or if the PR URL lookup fails
(due to network error, `gh` authentication, PR deletion, etc.), jarvis still
prints `spec complete` and exits 0. In the failure case, a `harness` warning
naming the lookup failure is printed to the log.  The run terminal, session
log, and log server all receive the PR URL via the same `spec complete` output
channel.

## Draft PR body

When a run in `git: true` mode completes its first subspec and opens a draft
PR, jarvis generates the PR body deterministically from the index spec on disk.
This step does not invoke the agent a second time. If deterministic generation
is empty (for example, a degenerate index with no usable headings), jarvis
falls back to the spec display name plus `Auto-generated by jarvis`.

## Loop-only mode (`git: false`)

The top-level `git` config flag (and per-project override
`projects[<name>].git`; see [config.md](./config.md)) controls whether jarvis
participates in git and gh during a run. When effective `git` is `false`:

- No worktree is created. The agent's `cwd` is the resolved project's
  `root`, or the value of `--cwd <dir>` if supplied.
- No per-subspec commit, push, draft PR open, or ready-on-complete happens.
- The completion check is the unchecked-boxes count only; the clean-tree
  requirement and exit code `6` do not apply.
- Worktree-related config (`worktreeSymlinks`) is ignored.

When effective `git` is `true` and the resolved project root is not a git
checkout, `jarvis run` exits 1 with `error: target is not a git checkout;
set "git": false in config or pass --repo to a git checkout` before invoking
any agent.

## Plan mode

Plan mode (`jarvis plan [<intent-file|"inline text">]`) drafts new specs collaboratively with an agent, while `jarvis run` implements existing specs. Plan mode creates a dedicated worktree and branch (`plan/<name>/` and `plan-<name>/`) and produces a draft PR with an agent-generated spec tree; the spec remains in draft status until the user merges it to `main`.

Full details — phases, flags, stop conditions, PR lifecycle, and cleanup — appear in
[docs/plan-mode.md](./plan-mode.md).

## Preflight checks

Before any side-effecting work (worktree creation, `gh` invocation, agent
spawn, session log open), `jarvis run` runs these checks in order:

1. **Project root exists.** The path resolved by the steps under
   [Iteration](#iteration) must be an existing directory. If it is missing
   (registered project moved or deleted, ad-hoc walk landed on a vanished
   root, `--repo` matched a stale registration, or a spec `repo:` line
   pointed at a missing path), jarvis exits 1 with a message naming the path
   and the resolution source. This check fires regardless of effective
   `git`, since loop-only mode also needs a valid `cwd` for the agent.
2. **`git: true` only.** When effective `git` is `true`, jarvis verifies the
   resolved root contains a `.git` entry (the "target is not a git checkout"
   guard above) and then runs `assertGhReady()` to confirm `gh` is on
   `PATH` and authenticated.

Only after these pass does jarvis create the per-spec worktree and start the
loop.

### `--cwd <dir>`

`--cwd <dir>` overrides the agent's working directory and is only valid when
effective `git` is `false`. It must point at an existing directory.
Combining `--cwd` with `git: true` exits 1 with a message explaining the
constraint. Spec resolution still proceeds normally; only the agent `cwd`
changes.

## Patch mode model selection

Patch mode selects the model declared on the chosen agent's
`modes.patch.agentOrder` entry (see [config.md](./config.md)). Patch mode is
intended for scoped implementation work from an active spec, so the defaults
prefer lower-cost coding-capable models over deep-thinking models.

Jarvis validates the local config shape before invoking an agent, so a
malformed `agentOrder` entry (missing or empty `model`, unknown `agent`)
fails before any CLI runs. Jarvis does not query
providers or CLIs before running to validate model availability. If the
selected agent CLI reports that the configured model is unsupported, jarvis
exits with a model-configuration message and does not fall back to another
agent. Fallback is reserved for quota exhaustion: if an agent reports quota
exhaustion, jarvis removes it from the active list for that run and falls back
to the next configured agent. See [quota-signals.md](./quota-signals.md) for
the detection rules.

## Output destinations

The `jarvis run` terminal, session files, and log server serve different
purposes:

- **Run terminal**: operator-focused output showing harness status and
  progress. Prints the iteration banner, agent fallback messages, completion
  status, and stop reasons. Does **not** print successful agent stdout/stderr
  to keep the terminal concise. On no-progress or max-iteration stops, prints
  a bounded tail (last 40 lines) of the latest iteration's inbound output
  before the stop line to help diagnose the failure.
- **Session log file**: the canonical complete transcript. Located at
  `~/.jarvis/sessions/<project-key>:<spec-name>-<timestamp>.log`, it contains
  every log record including harness status, iteration banners, outbound
  prompts, full inbound stdout/stderr, quota messages, and
  model-configuration failures. Use this file to reconstruct the complete run
  if you need details not shown in the terminal.
- **Log server**: live full-transcript viewer for monitoring across sessions.
  Receives the same complete tagged stream as the session log, namespaced as
  `<project-key>:<spec-name>` so concurrent specs in the same project remain
  distinguishable. Accessible via `jarvis log-server`. Shipping to the log
  server is best-effort after the startup connectivity check: lines may
  arrive out of order or be silently dropped under load. The on-disk
  session log is the authoritative record.
- **Run telemetry file**: append-only JSONL at `~/.jarvis/runs.jsonl` (or
  `telemetryPath` from config). Jarvis appends one line at each iteration end
  and one terminal-state line when the run exits (complete, max-iter,
  quota-exhausted, blocked, timeout, or error). On a successful completing
  iteration both records are written for that iteration: the per-iteration
  line (`exit_reason: "criteria-complete"` or `"criteria-progress"`) and the
  terminal line (e.g. `exit_reason: "completed-spec"`). A two-iteration run
  that completes therefore writes three lines total. Set `telemetryPath` to
  `null` to disable.

### Token usage and cost tracking

Each telemetry record optionally includes token usage and cost information when
available. These fields are:

- **`usage`**: Object with `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, and `cache_creation_input_tokens` (each `number |
  null`). When an agent CLI exposes token counts, they are recorded here.

- **`usage_source`**: How the usage data was obtained. One of:
  - `"agent"` — real token counts from the agent CLI.
  - `"unavailable"` — the agent CLI does not expose token counts.
  - `null` — no agent has populated usage yet (initial state, or agent does not
    support usage extraction).

- **`cost_usd`**: Estimated USD cost for the iteration (`number | null`). Computed
  from token counts and rates in `data/prices.json` (see below). `null` when
  cost cannot be computed.

- **`cost_source`**: How the cost was derived. One of:
  - `"computed"` — calculated from `usage` and the price table.
  - `"agent"` — agent CLI provided a dollar figure directly.
  - `"no-price"` — token counts exist but the model has no published rates.
  - `"no-usage"` — no token counts were available to compute from.
  - `null` — no cost has been computed yet (initial state).

### Price table

Jarvis maintains a price table at `data/prices.json` with per-model token rates
in USD per million tokens (per-MTok). Each entry includes:

- `input_per_mtok`: input token rate (or `null` if unavailable).
- `output_per_mtok`: output token rate (or `null` if unavailable).
- `cache_read_per_mtok` (optional): cache read rate; falls back to
  `input_per_mtok` if omitted or `null`.
- `cache_write_per_mtok` (optional): cache write rate; falls back to
  `input_per_mtok` if omitted or `null`.
- `source_url`: URL where rates were sourced.
- `as_of`: date rates were last confirmed (ISO 8601 format).
- `manual` (optional): `true` if this row requires manual maintenance.
- `manual_note` (optional): explanation of why manual maintenance is needed.

Cost is computed as:
```
(input_tokens * input_per_mtok +
 output_tokens * output_per_mtok +
 cache_read_input_tokens * (cache_read_per_mtok ?? input_per_mtok) +
 cache_creation_input_tokens * (cache_write_per_mtok ?? input_per_mtok))
/ 1_000_000
```

When rates are `null` and no fallback exists, the bucket contributes `0` to the
sum and `cost_source` is set to `"no-price"` to indicate incomplete data rather
than zero cost.

Codex usage is sourced from Codex's session JSONL output in
`~/.codex/sessions/` after each `codex exec` invocation. Jarvis reads the
newest session file created by that invocation and extracts the final running
token totals from `token_count` events.

`jarvis run` requires the local log server to be reachable before the loop
starts. If the server is down or misconfigured, run exits non-zero and prints
a connectivity error. Start it in a separate terminal:

```sh
jarvis log-server
```

## Stop conditions and exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Spec complete. |
| `1` | Bad input (unknown command, missing args, invalid `--max-iterations`, unregistered project, etc.). |
| `2` | Every configured agent was quota-exhausted. |
| `3` | The active agent failed for a non-quota reason. |
| `4` | A successful agent iteration made no progress (unchecked count unchanged and spec still incomplete). |
| `5` | The configured `maxIterations` was reached. Default is 10; override with `--max-iterations <n>`. |
| `6` | The run cannot continue because the worktree is dirty. This includes a completed checklist with uncommitted changes, or an agent iteration that edited files without ticking any new acceptance-criteria checkbox in the active subspec. The bail message ends with a pointer to `jarvis triage <worktree-name>` to inspect the state and see suggested next moves. Tick satisfied acceptance criteria, fix, or revert the dirty changes before rerunning. |
| `7` | The run is blocked. The active subspec gained a `## Blocker` section (or already had one at the start). Any work from the iteration is committed and pushed. The blocker body is printed to stderr. Fix the underlying issue or remove the blocker section from the spec, then rerun. |
| `8` | An iteration or global run timeout was exceeded. Configure `iterationTimeoutMs` (default 30 minutes) and optional `runTimeoutMs` in config. |
| `9` | The worktree is in use by another process. A process with a higher `pid` is currently operating on this worktree. Wait for that process to finish or use `jarvis triage <worktree-name>` to inspect the lock state. |
| `130` | Interrupted with Ctrl-C. |

On exit `4` and `5`, the bounded tail of recent agent output is printed to the
terminal to help diagnose why progress stalled.
