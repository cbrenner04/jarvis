# Run loop

Reference for `jarvis run` semantics: how iterations are selected, how
completion is detected, where output goes, and how runs stop.

## Iteration

`jarvis run <spec-path>` resolves the requested spec to an absolute path and
reads it first. Every runnable spec must include `repo: <absolute-path>`.
Jarvis uses that path to prepare the per-spec
[worktree](./worktrees-and-commits.md) and as the base `cwd` for `gh`, git, and
the agent. The operator’s shell working directory may be outside any repository,
such as a parent directory of several clones. From that point, Jarvis runs
agents from `agentOrder` until the active spec has no unchecked boxes.

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
guidance and injects jarvis-owned rules from `rules/patch-mode.md` inline.

## Completion

Jarvis treats a spec as complete when the spec file has zero unchecked
GitHub-style task list items. An unchecked item is a line matching
`^\s*- \[ \]\s`; checked items use `- [x]` or `- [X]`.

When the agent `cwd` is a git checkout (normal runs that use a worktree),
Jarvis also requires a clean `git status` before printing **spec complete**.
That way checkbox completion cannot succeed while changes are still only on
disk.

A spec with no task list checkboxes is malformed. Jarvis fails fast instead of
treating it as complete.

## Patch mode model selection

Patch mode selects the model configured for the chosen agent in `patchModels`
(see [config.md](./config.md)). Patch mode is intended for scoped
implementation work from an active spec, so the defaults prefer lower-cost
coding-capable models over deep-thinking models.

Jarvis validates the local config shape before invoking an agent, so malformed
`patchModels` config fails before any CLI runs. Jarvis does not query
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
  distinguishable. Accessible via `jarvis log-server`.

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
| `6` | Every checklist item is checked, but the worktree is not clean. Commit and push so the PR matches the run. |
| `130` | Interrupted with Ctrl-C. |

On exit `4` and `5`, the bounded tail of recent agent output is printed to the
terminal to help diagnose why progress stalled.
