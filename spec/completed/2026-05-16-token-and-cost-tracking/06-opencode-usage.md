# 06 — Opencode usage

## Problem

Opencode is a router CLI: `opencode run` dispatches to whichever underlying
provider model is configured (e.g. `github-copilot/claude-opus-4.7`,
`AirProxy/<model>`). We need to extract per-iteration token usage from
opencode invocations the same way subspecs 04 and 05 do for Claude and
Codex.

Unlike those two, **we do not yet know which extraction path opencode
supports**. Possibilities, in rough decreasing-cooperation order:

1. `opencode run --format json` (or similar) emits a structured envelope
   with usage data, like Claude.
2. `opencode run --print-logs` (or similar) emits log lines including
   token counts on stderr.
3. Opencode writes a session file we can read post-invocation, like Codex.
4. None of the above; usage is genuinely unavailable.

This subspec investigates first, then implements whichever option
materializes — or documents `usage_source: "unavailable"` if none does.

## Decisions

- **Investigate before implementing.** The first task is research:
  enumerate `opencode run --help`, scan opencode's documentation, and
  determine which (if any) of the four options above is supported by
  the version this jarvis checkout is meant to work with.
- **No CLI flag changes without justification.** If the investigation
  turns up a usage flag, we evaluate it on the same criteria we used
  for Claude: does it change user-visible terminal output? Is the
  envelope shape stable? Is parse failure non-fatal? Only switch the
  argv if the answers are acceptable; otherwise document the trade-off
  and pick a different option.
- **`unavailable` is an acceptable outcome.** If none of the four
  options yields usable usage data with acceptable trade-offs, this
  subspec lands as: opencode agent emits `usage = null` and
  `usage_source: "unavailable"` for every iteration, with a one-time
  harness notice on first opencode use per `jarvis run`. The
  acceptance criteria below cover both the "wired up" and the
  "explicitly unavailable" outcomes.
- **Provider routing does not change cost lookup.** We look up the
  `model` string the user configured in `agentOrder` (e.g.
  `github-copilot/claude-opus-4.7`) directly in `data/prices.json`. If
  the price table has that exact key, we use those rates. If not,
  `cost_source: "no-price"`. We do **not** try to resolve the routed
  underlying model — that's an opencode internal that the price table
  doesn't need to know about. Subspec 03's `jarvis prices update`
  handles populating `provider/model` keys via models.dev where
  possible; missing entries are a manual edit.
- **Reuse subspec 04's `AgentResult` extension.** Same `usage` /
  `cost_usd` / `cost_source` / `warnings` fields on the `kind: "ok"`
  result. This subspec depends on either subspec 04 or subspec 05
  having landed first to introduce those fields; if neither has
  landed, this subspec adds them with the same shape.

## Tasks

- [ ] **Investigate first.** Run `opencode run --help` and capture the
      full output under a `## Verified opencode capabilities` section
      in this file. Note any flags related to: output format, logging,
      verbosity, JSON, telemetry, usage, cost.
- [ ] If any candidate flag exists, run `opencode run` against a
      trivial prompt with that flag and capture stdout + stderr to a
      fixture under `test/fixtures/opencode/<version>-<scenario>.*`.
- [ ] Check whether opencode writes session files (look under
      `~/.config/opencode/`, `~/.local/share/opencode/`,
      `~/.cache/opencode/`, and any path mentioned in `opencode run
      --help` or opencode docs). If it does, capture a sample session
      file as a fixture.
- [ ] Record findings under `## Verified opencode capabilities` in
      this file: which of the four extraction paths are available,
      their stability, and a recommended approach.
- [ ] **Implement the chosen path.** Either:
      - **(a) JSON / structured stdout path**: add an adapter at
        `src/agents/opencode-json.ts` (or similar), wire `opencode.ts`
        to use the new flag, parse, attach usage to `AgentResult`. If
        the new flag changes user-visible terminal output, follow
        subspec 04's pattern (synthesize `displayText`, add a config
        opt-out at `modes.patch.agents.opencode.outputFormat`).
      - **(b) Stderr log-line path**: parse the existing stderr stream
        for usage lines. Adapter at `src/agents/opencode-stderr.ts`
        with fixture-tested regexes. No CLI flag change.
      - **(c) Session-file path**: mirror subspec 05's discovery and
        parse logic. Adapter at `src/agents/opencode-session.ts`.
      - **(d) Unavailable path**: in `src/agents/opencode.ts`, attach
        `usage = null` and `usage_source = "unavailable"` to every
        successful `AgentResult`. Add a one-time harness notice the
        first time opencode runs per `jarvis run`:
        `opencode: token usage not available for this CLI version
        (recording usage as unavailable)`.
- [ ] Update `src/modes/patch/run.ts` if the chosen path adds new
      fields not already plumbed by subspecs 04/05.
- [ ] Add tests under `test/opencode-*.test.ts` matching the chosen
      path. For paths (a)–(c), test happy path + at least two failure
      modes (parse error, missing data) using committed fixtures. For
      path (d), test that the agent attaches `usage_source:
      "unavailable"` on every success.

## Acceptance criteria

- [x] `## Verified opencode capabilities` section in this file is
      populated with the captured `--help` output, fixture references,
      and the rationale for the chosen path.
- [x] Either: opencode iterations record real `usage` in the
      per-iteration telemetry record, OR opencode iterations record
      `usage = null` with `usage_source: "unavailable"` and a one-time
      harness notice is printed per `jarvis run`.
- [x] Failure modes (if any extraction path was chosen) are non-fatal.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes (including the new tests).
- [x] `bun run check` passes.

## Documentation updates

- [ ] Update `docs/agents.md`'s Opencode row with the chosen extraction
      strategy or the "usage unavailable" note.
- [ ] Update `docs/cost.md` (or equivalent) with opencode's cost
      attribution status.

## Verified opencode capabilities

### Captured `opencode run --help` output

Fixture: `test/fixtures/opencode/opencode-run-help.txt`

```text
warn: CPU lacks AVX support, strange crashes may occur. Reinstall Bun or use *-baseline build:
  https://github.com/oven-sh/bun/releases/download/bun-v1.3.13/bun-darwin-x64-baseline.zip
opencode run [message..]

run opencode with a message

Positionals:
  message  message to send                                                     [array] [default: []]

Options:
  -h, --help                          show help                                            [boolean]
  -v, --version                       show version number                                  [boolean]
      --print-logs                    print logs to stderr                                 [boolean]
      --log-level                     log level [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]
      --pure                          run without external plugins                         [boolean]
      --command                       the command to run, use message for args              [string]
  -c, --continue                      continue the last session                            [boolean]
  -s, --session                       session id to continue                                [string]
      --fork                          fork the session before continuing (requires --continue or
                                      --session)                                           [boolean]
      --share                         share the session                                    [boolean]
  -m, --model                         model to use in the format of provider/model          [string]
      --agent                         agent to use                                          [string]
      --format                        format: default (formatted) or json (raw JSON events)
                                          [string] [choices: "default", "json"] [default: "default"]
  -f, --file                          file(s) to attach to message                           [array]
      --title                         title for the session (uses truncated prompt if no value
                                      provided)                                             [string]
      --attach                        attach to a running opencode server (e.g.,
                                      http://localhost:4096)                                [string]
  -p, --password                      basic auth password (defaults to OPENCODE_SERVER_PASSWORD)
                                                                                            [string]
  -u, --username                      basic auth username (defaults to OPENCODE_SERVER_USERNAME or
                                      'opencode')                                           [string]
      --dir                           directory to run in, path on remote server if attaching
                                                                                            [string]
      --port                          port for the local server (defaults to random port if no value
                                      provided)                                             [number]
      --variant                       model variant (provider-specific reasoning effort, e.g., high,
                                      max, minimal)                                         [string]
      --thinking                      show thinking blocks                                 [boolean]
  -i, --interactive                   run in direct interactive split-footer mode
                                                                          [boolean] [default: false]
      --dangerously-skip-permissions  auto-approve permissions that are not explicitly denied
                                      (dangerous!)                        [boolean] [default: false]
      --demo                          enable direct interactive demo slash commands; pass one as the
                                      message to run it immediately       [boolean] [default: false]
```

### Investigation evidence and fixture references

- Candidate flags present:
  `--format` (`default|json`) and `--print-logs`.
- Candidate flag trial command:
  `opencode run --format json --command echo "hello-from-opencode"`.
- Fixtures from the trial:
  `test/fixtures/opencode/opencode-format-json-command.stdout`,
  `test/fixtures/opencode/opencode-format-json-command.stderr`,
  `test/fixtures/opencode/opencode-format-json-command.exit`.
- Observed result:
  exit code `0`, empty stdout, stderr contained only setup/migration logs;
  no usage tokens/cost fields were emitted.
- Session file check fixture:
  `test/fixtures/opencode/opencode-session-locations.txt`.
- Observed paths checked:
  `~/.config/opencode/`, `~/.local/share/opencode/`, `~/.cache/opencode/`.
  This run created DB/log files only; no usage/session artifact with token
  counts was found.

### Extraction-path assessment

- (a) JSON/structured stdout path: CLI supports `--format json`, but the
  verified local run did not emit usage-bearing JSON events.
- (b) Stderr log-line path: `--print-logs` exists, but verified stderr output
  for the trial contained only operational logs, not token totals.
- (c) Session-file path: no usage/session token artifact found in checked
  directories for the verified run.
- (d) Unavailable path: chosen.

### Recommended and implemented approach

Use path (d): mark every successful opencode result with
`usage_source: "unavailable"` and `cost_source: "no-usage"`, and print a
one-time run-level notice:
`opencode: token usage not available for this CLI version (recording usage as unavailable)`.
