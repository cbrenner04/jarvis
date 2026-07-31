# Install and config

Fresh-checkout walkthrough: clone, symlink the v2 CLI, configure the machine,
start the daemon, confirm it is up. Config and daemon contracts live in
[`agent-model-config.md`](./agent-model-config.md),
[`write-behavior.md`](./write-behavior.md#daemon-cli), and
[`daemon-host.md`](./daemon-host.md); this doc stitches them into one path.

## Prerequisites

- **Bun** — runtime for both `jarvis` (v2) and `jarvis1` (v1).
- **`gh` authenticated** — `gh auth status` succeeds (publication and PR flows).
- **At least one agent CLI on `PATH`** — e.g. `claude`, `codex`, or `cursor`.

## Install

Clone the repo and symlink both binaries onto `PATH`. `package.json` `bin` maps
`jarvis` → `bin/jarvis` → `v2/src/cli.ts` and `jarvis1` → `bin/jarvis1` →
`v1/src/cli.ts`.

```bash
git clone <repo-url> jarvis
cd jarvis
ln -s "$(pwd)/bin/jarvis"  <dir-on-PATH>/jarvis
ln -s "$(pwd)/bin/jarvis1" <dir-on-PATH>/jarvis1
```

Verify: `jarvis config path` prints an absolute path (see [Config](#config)).

## Config

Two layers — do not conflate them:

| Layer | Path | Contents |
| --- | --- | --- |
| **Per-machine** | `~/.jarvis/config.json` (expanded absolute path from `jarvis config path`) | Agent fallback order (`agents`), required `machineProfile` selector, optional `projects` registry |
| **Machine-independent** | Repo `config/machines/<profileName>.json` | Role→model store (`models` map: agent → role → `rungs`); seeded profiles include `home` and `work` |

Full schema and validation rules: [`agent-model-config.md`](./agent-model-config.md).

### `jarvis config`

| Command | Output | Exit |
| --- | --- | --- |
| `jarvis config show` | Configured `agents`, one name per line; or `No machine agent override configured.` when the file is absent or has no `agents` key | `0` on success; `1` with a config-read error on stderr when the file is invalid |
| `jarvis config path` | Fully expanded absolute path to the machine config file (no tilde substitution) | `0` |
| `jarvis config set-agents <csv>` | `{"agents":[...]}` JSON with the landed order | `0` on success; `1` on bad CSV or invalid existing file |

`set-agents` takes bare comma-separated agent names (trimmed segments; rejects
empty segments and any segment containing `:`). It replaces the full `agents`
array and preserves other top-level keys.

Example bootstrap:

```bash
jarvis config set-agents claude,codex,cursor
# {"agents":["claude","codex","cursor"]}

jarvis config show
# claude
# codex
# cursor
```

### Required `machineProfile` hand-edit

No `jarvis config` subcommand writes `machineProfile`. `show` and `path` are
read-only; `set-agents` writes only `agents`. Role→model resolution
hard-requires `machineProfile`, so the CLI alone cannot produce a runnable
machine.

After `set-agents`, edit `~/.jarvis/config.json` and add a profile name that
matches a committed file under `config/machines/`:

```json
{
  "agents": ["claude", "codex", "cursor"],
  "machineProfile": "home"
}
```

Use `work` when this machine should not load Claude bindings
(`config/machines/work.json`). Profile contracts:
[`agent-model-config.md`](./agent-model-config.md#storage-split).

### Project registry

Optional `projects` entries map a registry key to a project object. `root` is required;
`origin` is optional. Longest matching root wins when resolving a spec path to a
project.

Per-project implement defaults:

| Key | Type | Default | Validation |
| --- | --- | --- | --- |
| `projects.<key>.implement.reviewPasses` | non-negative integer | `1` when absent | Rejected at implement launch when present but fractional, negative, or non-integer |
| `projects.<key>.implement.reviewBehavior` | `"debate"` or `"light"` | `"debate"` when absent | Rejected at implement launch when present but not `"debate"` or `"light"` |

Each registered project may configure a source-owned pipeline for `jarvis pipeline start` only (`jarvis run workflow implement` ignores `projects.<key>.pipeline` entirely; absence admits legacy implement with no `pipelineDefinition` and refuses `jarvis pipeline start`):

| Key | Type | Validation |
| --- | --- | --- |
| `projects.<key>.pipeline` | object | Required for `jarvis pipeline start`; ignored by implement admission |
| `projects.<key>.pipeline.name` | non-empty string | Required when `pipeline` is present; must name a source-registry pipeline |
| `projects.<key>.pipeline.terminalAction` | `"leave-draft"`, `"ready"`, or `"merge"` | Required when `pipeline` is present; names how the pipeline leaves the final PR |
| `projects.<key>.pipeline.reviewOverrides` | object of stage ID → string | Optional; each key must name a workflow stage, not an approval stage |

`jarvis pipeline start` resolves `projects.<key>.pipeline` through project-pipeline resolution before daemon connect. Implement admission does not read or validate this block. The object accepts only `name`,
`terminalAction`, and `reviewOverrides`. Missing or malformed pipeline fields, unknown `terminalAction` values,
non-string override values, forbidden keys, unknown stage IDs, approval-stage override
targets, and terminal actions on pipelines with no `implement` workflow stage fail with
`invalid-project-pipeline-config` naming the full offending config path. An unknown name
fails with `unknown-pipeline`; a selected or overridden definition rejected by the
definition validator fails with `invalid-pipeline-definition`. Selection is strict and has
no default pipeline.

`terminalAction` is copied onto the admitted pipeline definition at resolution and is not
stored on source-registry rows. Hand-edited configs must add `terminalAction` when
`pipeline` is present; there is no migration machinery.

`reviewOverrides` keys are pipeline `stageId` values, not workflow names. They change
only the selected definition's copied workflow stage. They do not compose with or
override `implement.reviewBehavior`: that setting and `--review-behavior` still control
the separate legacy post-implement review step.

Complete project example:

```json
{
  "projects": {
    "jarvis": {
      "root": "/Users/me/Work/jarvis",
      "origin": "git@github.com:me/jarvis.git",
      "pipeline": {
        "name": "full-review",
        "terminalAction": "ready",
        "reviewOverrides": {
          "plan": "light",
          "implement": "debate"
        }
      },
      "implement": {
        "reviewPasses": 1,
        "reviewBehavior": "light"
      }
    }
  }
}
```

### Workflow invocation bounds

Direct `jarvis write` and workflow write steps resolve three optional machine keys from
`~/.jarvis/config.json` before dispatch. The same machine-wide
`idleOutputTimeoutMs` also governs every workflow review-role invocation.

| Key | Role | Default | Validation |
| --- | --- | --- | --- |
| `iterationTimeoutMs` | Progress-extended wall segment per iteration | `600000` (10 min) | Positive number |
| `iterationCeilingMs` | Hard ceiling on total iteration wall time | `1800000` (30 min) | Positive number; must be ≥ resolved `iterationTimeoutMs` |
| `idleOutputTimeoutMs` | Idle-output watchdog budget for workflow write and review roles | `90000` (90 s) | Non-negative integer; `0` disables; when `> 0` must be ≤ resolved `iterationTimeoutMs` |

Inverted idle/wall or wall/ceiling ordering fails at load with a message naming both
compared keys and numeric values. `idleOutputTimeoutMs` is armed on the iteration's
step invocation and its token/blocker reprompts: a silent invocation settles
`idle_output_timeout` well before the wall segment or ceiling could fire,
distinguishing a stalled agent from a genuinely slow one. (The post-iteration
coverage-advisory invocation is unarmed — no wall, ceiling, or idle bound.)
`0` disables the watchdog outright (no `idleOutputMs` bound is resolved), leaving the
wall segment and ceiling as the only bounds. Resolved `iterationTimeoutMs`,
`iterationCeilingMs`, and `idleOutputMs` (when armed) are stamped on workflow write
steps and persisted in workflow snapshots for resume and revise.

Review and review-debate steps retain the configured `idleOutputTimeoutMs` value:
a positive value arms each role, and `0` is passed through to disable that role's
idle watchdog. When the key is absent, the step leaves `idleOutputMs` unstamped
and the review-role invocation uses its 90 s fallback.

An explicit `jarvis run workflow implement --review-passes <n>` overrides the
registered-project value; `--review-passes 0` skips review. An explicit
`--review-behavior debate|light` overrides the registered-project review
behavior.

### Review-role timeout

`reviewRoleTimeoutMs` bounds each critic/actuator/debate-role invocation on
`review` and `review-debate` workflow steps. Optional, defaults to `1800000`
(30 min); must be a positive number, else workflow launch fails with a message
naming the key. Resolved alongside the write-path bounds and stamped on the
built review/review-debate steps.

## Daemon

Socket and PID paths (production defaults): `~/.jarvis/daemon.sock`,
`~/.jarvis/daemon.pid`. Transport detail: [`daemon-host.md`](./daemon-host.md).

| Command | Output | Exit |
| --- | --- | --- |
| `jarvis daemon start` | `{"pid":<n>,"socketPath":"..."}` | `0` on success; `1` with `<ErrorName>: <message>` on lifecycle failure |
| `jarvis daemon status` | `running` or `stopped` | `0` when running; `1` when stopped |
| `jarvis daemon stop` | `stopped` | `0` |

Start and confirm:

```bash
jarvis daemon start
jarvis daemon status   # expect: running (exit 0)
```

`jarvis daemon status` reporting `running` with exit `0` is the up-confirmation
step. Full CLI contract: [`write-behavior.md`](./write-behavior.md#daemon-cli).

## Recovery

Errors surface at different commands — fix the file or knob the message names,
then re-run **that** command.

### Config-load errors → `jarvis config show`

Surfaced when reading `~/.jarvis/config.json` (also blocks `set-agents` writes
against an invalid file):

| Symptom (stderr) | Fix |
| --- | --- |
| `Failed to parse machine config at <path>: invalid JSON` | Repair JSON syntax |
| `Machine config at <path> must be a JSON object, got …` | Root must be a JSON object, not an array or primitive |
| `Machine config 'agents' must be an array, got …` | Set `agents` to a JSON array |
| `Machine config 'agents' array must not be empty` | Provide at least one agent |
| `Machine config 'agents' entry at index N must be a string, got …` | Use string agent names |
| `Machine config 'agents' entry at index N must not be an empty string` | Remove empty entries |
| `Machine config 'agents' contains duplicate entry: "<name>"` | Deduplicate `agents` |

`set-agents` CSV parse failures (before any write) print their own stderr lines
and exit `1` without mutating the file.

### Model-resolution errors → `jarvis run` (and `jarvis write`)

These run after machine config parses. They surface when building a run/write
input — e.g. `jarvis run start …`, `jarvis run workflow implement …`, or
`jarvis write …` — not at `jarvis config show`.

| Symptom | Fix |
| --- | --- |
| `Machine config at <path> is missing required 'machineProfile' key` | Hand-edit `machineProfile` in `~/.jarvis/config.json` |
| `Machine profile '<name>' not found at <path>` | Fix the profile name or add `config/machines/<name>.json` |
| `Failed to load agent model config: Machine profile '<name>' at <path> is missing required 'models' key` | Add a `models` object to the profile file |

Profile load and `models` validation: [`agent-model-config.md`](./agent-model-config.md).

### Daemon-start failures → `jarvis daemon start`

| Symptom (stderr) | Fix |
| --- | --- |
| `DaemonAlreadyRunningError: Daemon already running on socket <path>` | Use the existing daemon (`jarvis daemon status`) or `jarvis daemon stop` first |
| `DaemonReadinessTimeoutError: Daemon failed to become ready on socket <path> within <ms>ms` | Inspect the child process / socket; stop and retry |
| `Error: PID file directory does not exist: <dir>` | Create `~/.jarvis/` (or the parent of the configured PID path) before starting |

Lifecycle API: [`daemon-host.md`](./daemon-host.md#daemon-lifecycle-api).
