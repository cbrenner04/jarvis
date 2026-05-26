---
name: v2-first-write-step
---
# Intent — v2 Phase 1: first write step, end-to-end

The next unchecked phase in [`v2/spec/v2-meta-index.md`](../../../v2/spec/v2-meta-index.md) is **Phase 1 — First write step, end-to-end (first working step)**, expanded in [`v2/docs/v2-build-order.md`](../../../v2/docs/v2-build-order.md) §Phase 1. Phase 0 (project scaffold, `bin/jarvis` shim, cross-tree boundaries) is already merged; v2 currently only handles `--version` and prints `v2 not ready` (`v2/src/cli.ts:14`).

This intent expands the Phase 1 build brief into target-state behavior to be implemented in `v2/src` and verified by tests there. Concrete code shape (file layout, function names, schemas) is for the spec drafter — this is only what must be true when Phase 1 is done.

## What ships

One `write` step, runnable **once** from the v2 CLI as a real end-to-end execution against a real agent CLI, with no daemon, no loop, no workflow runner, and no durable state. The walking skeleton of the v2 execution core: render → invoke → outcome → contract → worktree.

The user-visible result: `jarvis write <spec-path>` (exact command shape TBD by drafter) drives a single agent invocation against a spec, captures a structured outcome, deterministically verifies an output contract, and leaves changes in a v2-owned worktree the operator can `git diff` / commit-by-hand.

## Pieces in scope

Pulled from `v2/docs/v2-build-order.md` §Phase 1 and the supporting architecture sections in `v2/docs/v2-architecture.md`:

1. **Host-agnostic core function.** The whole render→invoke→outcome→contract→worktree path is a library function. Cancellation is via an `AbortSignal` parameter only — no `process.on('SIGINT')` or other global signal handling in the core. The core does not read `process.env` or `process.cwd` directly; the host passes them in.
2. **Thin CLI host.** A new v2 CLI subcommand wires `process.argv`, env, stdio, and a SIGINT→`AbortController.abort()` bridge into the core. Replaces the current `v2 not ready` path for the new subcommand only; bare `jarvis` with no args still prints `v2 not ready` so existing behavior (and the Phase 0 tests) keep passing.
3. **Prompt rendering via a shared registry.** A minimal prompt registry that resolves a `write` step's prompt template + inputs into the final string sent to the agent. Big enough to register one prompt and look it up by ID; not the full registry envisioned in `v2/docs/prompts.md`.
4. **Single agent invocation, one cli+model binding.** Invoke exactly one configured agent (cli + model). Bindings come from existing `~/.jarvis/config.json` shape where possible (or a v2-scoped equivalent if v1's shape doesn't fit — drafter decides). Real subprocess, real output.
5. **Quota fallback in the invocation layer.** When the invoked agent reports quota exhaustion (same signal classes v1 detects in `v1/docs/quota-signals.md`), the invocation layer rotates to the next configured agent in order and retries the same prompt. No fallback for model-config or other hard errors. Order is the v2 equivalent of `modes.patch.agentOrder`.
6. **Outcome token capture.** Agent emits one of the four tokens defined in `v2/docs/v2-architecture.md` §Output contract: `progress`, `done`, `no-work`, `blocked`. The core parses one outcome per invocation. Phase 1 only needs to *act* on terminal outcomes (`done` / `no-work` → check contract; `blocked` → stop and surface; `progress` → stop too, since there is no loop yet).
7. **Deterministic output contract check.** On `done` / `no-work`, run a deterministic verification (no agent calls) of the expected artifact for the `write` step. Exact contract primitive vocabulary is still open (architecture §Output contract notes this), so Phase 1 picks the smallest concrete contract that proves the path — e.g. "spec file exists and at least one previously-unchecked acceptance criterion is now checked," or whatever the drafter picks. Mismatch ⇒ surface as a blocker; never silent retry.
8. **Worktree creation under `~/.jarvis/worktrees/<project>/<branch>/`.** Per `v2/docs/v2-architecture.md` §Git, worktrees & PRs: linked git worktree, outside the repo. The write step runs with the worktree as its working directory. No branch push, no PR — that's Phase 8.
9. **`.jarvis.lock` coexistence.** A v2 run on a worktree must not stomp a v1 lock there, and vice versa. The exact ownership rules are in §Git, worktrees & PRs — v2 daemon will own its worktrees in-memory later, but Phase 1 just needs to refuse to start (or recover a stale PID) when a lock is present, matching v1's behavior closely enough that the two harnesses cohabit.
10. **No durable state.** Worktree + git is the only persistence. No SQLite. No telemetry rows. (Phase 2 introduces durable state.)

## Explicit non-goals

To keep the walking skeleton thin:

- No loop. Exactly one invocation per CLI call. `progress` is a terminal outcome here.
- No workflow runner, no multi-step composition, no per-step bindings.
- No daemon, no IPC, no structured log stream, no TUI.
- No durable state / SQLite / resume.
- No draft PR, no branch push, no `gh` calls, no commits made by the core (the operator inspects/commits manually).
- No review-and-update behavior, no human-loop steering API.
- No concurrency / admission / queueing.
- No local-model entry yet (Phase 7).
- v1 (`jarvis1`) keeps working unchanged; this phase does not touch `v1/src/**` or `v1/docs/**`.

## Constraints & conventions

- Strict TypeScript, Bun, co-located tests under `v2/src/**/*.test.ts`. Cross-tree import boundary (`v1/** ↔ v2/**` banned, Phase 0) must keep passing.
- `bun run typecheck`, `bun test`, `bun run check`, `bun run ready` all pass.
- No planning labels in code (per `AGENTS.md`): nothing called `phase1`, `walkingSkeleton`, `firstStep` in identifiers or filenames. Name things what they are (`runWriteStep`, `invokeAgent`, `verifyWriteContract`, etc. — drafter's call).
- Tests must verify behavior outside the spec tree itself — exercise the core function with a fake agent invoker, a tmp worktree, and assert real artifact / outcome / error behavior. No tests that only grade spec prose.
- Subspecs in the drafted plan should be sized roughly one PR each.

## Suggested subspec slicing (for the drafter, not binding)

A plausible split — drafter may regroup as long as each subspec is independently mergeable and runnable:

1. v2 agent-invocation layer: subprocess shape, outcome-token parsing, quota classification, quota fallback over a configured order. Tested with a fake-CLI subprocess.
2. v2 worktree layer: create/reuse `~/.jarvis/worktrees/<project>/<branch>/`, `.jarvis.lock` ownership/stale recovery compatible with v1's lock file. Tested against a real local git repo in a tmp dir.
3. Prompt registry (minimal) + `write`-step contract verifier. Pure, deterministic, fully unit-tested.
4. Host-agnostic `runWriteStep` core that wires 1–3 together behind an `AbortSignal`. Tested with the fake invoker end-to-end against a tmp git repo.
5. Thin CLI host subcommand: argv parsing, SIGINT→abort bridge, exit-code mapping, human-readable terminal output for the four outcome classes + contract failure + abort + quota-exhausted-all-agents. Tested via the existing `main(argv, io)` shape in `v2/src/cli.ts`.

## Acceptance signals (target state, for the drafter to turn into per-subspec criteria)

When Phase 1 is done, all of these should be objectively checkable against merged code in `v2/src`:

- A new v2 CLI subcommand exists and is documented in `v2/docs/` (likely a new short doc or an update to an existing one; drafter chooses) and in the top-level `README.md` v2 section.
- Running that subcommand against a tiny example spec with a fake / mock agent in tests:
  - creates a worktree under a configurable `~/.jarvis/worktrees`-style root,
  - invokes the agent exactly once per attempt,
  - rotates to the next configured agent on a simulated quota signal and stops rotating on the first non-quota outcome,
  - parses each of the four outcome tokens correctly,
  - runs the deterministic contract check on `done` / `no-work` only, and surfaces a blocker on contract mismatch,
  - returns non-zero from the CLI on `blocked` / contract-fail / quota-exhausted-all / aborted, and zero on a successful `done`-with-contract-pass.
- Aborting via SIGINT (in a CLI-level test) cancels the in-flight invocation through the `AbortSignal` and exits non-zero with a clear stop reason.
- The core function in `v2/src` has no references to `process.on`, `process.argv`, `process.env`, or `process.cwd` (grep-checkable); all of those are confined to the CLI host module.
- A v1 run on a worktree path is not disrupted by a concurrent v2 attempt on the same path: v2 refuses to start when `.jarvis.lock` is held by a live PID (matching v1's exit `9`-equivalent behavior at the v2 layer).
- `bun run typecheck`, `bun test`, `bun run check`, `bun run ready` all pass on the final PR of the phase.
- `bin/jarvis` with no args still prints `v2 not ready`; `bin/jarvis --version` still works; `jarvis1` is unchanged.

## Open questions for the drafter to resolve

- Exact subcommand name and argv shape for the new v2 CLI entry point.
- Whether v2 reuses `~/.jarvis/config.json` directly for the agent order or introduces a `modes.v2.*` / scoped section now. (Prefer reuse; introduce new structure only if forced.)
- Smallest concrete output-contract primitive to ship for `write` (architecture explicitly leaves the full vocabulary open).
- Whether the worktree's branch is auto-derived from the spec name (v1's pattern) or supplied explicitly.
- Quota-signal source of truth: reuse v1's detection module directly is banned by the import boundary — port the rules or factor them into a shared module accessible to both? Drafter decides; document the choice.

## Documentation updates required

- New or updated doc under `v2/docs/` describing the v2 `write` command and the core function's contract (input, outcomes, exit codes).
- `README.md` "Repository Layout" / v2 section updated to reflect that `jarvis` now has one real subcommand beyond `--version`.
- `v2/spec/v2-meta-index.md` Phase 1 line ticked (by Jarvis at merge time, not the agent).

## Refinement

- Decision: agent-binding config reuses `~/.jarvis/config.json` `modes.patch.agentOrder` read-only for Phase 1 — no new schema, no `modes.v2.*`. Rationale: matches build-order "reuse, don't invent" and avoids a config migration this phase has no consumer for.
- Decision: agent-order config is loaded by the CLI host, passed into the core as a plain `ReadonlyArray<{ agent, model }>` value. Rationale: keeps the `process.env`/`process.cwd`/fs read out of the core (grep-checkable acceptance signal).
- Decision: only the v1 agents currently in default order (`claude`, `codex`, `cursor`) need a working v2 invocation adapter in Phase 1; `opencode` and `aider` are deferred unless they appear in the operator's configured order, in which case the v2 CLI exits with an unsupported-agent error rather than silently skipping. Rationale: walking-skeleton scope; matches v1's opt-in posture.
- Decision: outcome-token transport is a fenced line of the form `<!-- jarvis-outcome: done -->` (or equivalent single-line sentinel) parsed from agent stdout tail — exact sentinel string is the drafter's call but must be a single line and grep-stable. Rationale: agents already pass through markdown-style HTML comments cleanly (see codex correlation marker); avoids per-CLI JSON parsing.
- Deferred to first consumer: precise sentinel string and whether stderr is also scanned — pin when the write-step prompt registers its outcome instructions.
- Decision: when zero outcome tokens are emitted on a `0` exit, classify the attempt as a contract-fail blocker, not as `done`. Rationale: silence must never be promotable to success.
- Decision: when multiple outcome tokens are emitted, the last one wins. Rationale: matches "agent may clean up on later writes within one invocation"; one rule, no ambiguity.
- Decision: the Phase 1 `write` contract primitive is "the spec subspec file pointed at by the CLI argument has at least one acceptance-criteria checkbox transition from `- [ ]` to `- [x]` between pre- and post-invocation snapshots, and no `- [x]` was downgraded." Rationale: smallest concrete signal already used by v1 patch mode; deterministic; needs no schema design.
- Decision: contract verifier reads the file from the worktree (post state) and the pre-state from an in-memory snapshot taken before invocation; no second commit or git diff required. Rationale: deterministic, zero-IO beyond the spec file.
- Decision: contract check runs for both `done` and `no-work`. `no-work` with zero criteria movement is a contract pass (legitimate no-op); `no-work` with downgraded `- [x]` → `- [ ]` is a blocker. Rationale: prevents skip-by-claim while permitting honest no-ops; consistent with v2-architecture §Output contract "no-work treated as done".
- Decision: `blocked` outcome surfaces the agent's freeform blocker text (everything between the outcome sentinel and the prior outcome sentinel, or end of stdout if only one) verbatim to stderr. Rationale: blocker quality depends on agent prose; harness must not summarize.
- Decision: `progress` outcome on a single-invocation Phase 1 run exits non-zero with a `progress-without-loop` stop reason. Rationale: contract verifier cannot apply; advancing would silently swallow incomplete work; loop is Phase 2.
- Decision: worktree project segment derives from the registered project key when the resolved repo matches a registered project, else from the repo root basename. Rationale: matches v1 project-resolution order; avoids new resolution code.
- Decision: worktree branch is auto-derived from the spec directory basename (`<timestamp>-<slug>` → `<slug>` only) and may be overridden by an explicit `--branch` flag on the new subcommand. Rationale: v1 convention plus an escape hatch for re-runs on the same spec.
- Decision: when the derived branch already exists locally, v2 reuses it (`git worktree add <path> <branch>` against the existing branch); when it exists only on remote, v2 fetches and checks it out; when neither, v2 creates it from the default branch resolved via `gh repo view --json defaultBranchRef` or `git symbolic-ref refs/remotes/origin/HEAD`. Rationale: covers fresh runs, resumes, and rebased remotes without inventing new git mechanics.
- Deferred to first consumer: behavior when the existing branch has un-pushed commits from another machine — pin when the daemon/concurrency layer adds remote-state checks (Phase 3+).
- Decision: `.jarvis.lock` file format and PID/staleness semantics must be byte-compatible with v1's lock file (same path, same JSON keys, same liveness probe). Rationale: cohabitation requirement; divergence breaks v1 runs on the same worktree.
- Decision: v2 writes its lock with `agent: "v2"` (or equivalent disambiguator key) so v1 can identify a v2-held lock for diagnostics. Rationale: v1 already tolerates unknown keys; lets future v1 messages name the holder.
- Decision: locked-by-live-pid is exit code `9` from the v2 CLI; stale-pid recovery is silent (lock overwritten) with a single stderr line `recovered stale .jarvis.lock from PID <n>`. Rationale: matches v1's documented `9` and recovery wording closely enough for operators reading mixed logs.
- Decision: SIGINT inside the CLI host triggers `AbortController.abort()`; the core's only obligation is to propagate the signal to the spawned agent process group (SIGTERM, then SIGKILL after 5s) and return an `aborted` result. CLI maps `aborted` to exit `130`. Rationale: matches v1 abort semantics; keeps `process.on` confined to the host.
- Decision: agent subprocess is spawned in its own process group (`detached: true` + `process.kill(-pgid, ...)` on abort). Rationale: required for reliable cancellation of child shells the agent CLI spawns.
- Decision: quota-signal classification rules are **ported** into `v2/src/agents/quota.ts` (pattern lists + classifier function) rather than factored into a shared cross-tree module. Rationale: the import boundary is a hard rule and a shared module would have to live above both trees — design churn unwarranted by a single Phase 1 consumer. Port cost is one file of regexes.
- Decision: ported quota patterns are copied verbatim from `v1/src/agents/quota.ts` at the commit the Phase 1 PR is opened against, and a comment in `v2/src/agents/quota.ts` records that commit SHA + the v1 file path as the source of truth. Rationale: makes future re-sync mechanical and audit-able; matches "record decisions, constraints, assumptions".
- Decision: Phase 1 ports only **strict** quota patterns (and per-agent model-config patterns); the lenient `weakQuotaPatterns` + `weakQuotaExitCodes` + no-progress guard are out of scope. Rationale: weak quota requires the progress-guard signal that only the loop (Phase 2) can compute deterministically.
- Decision: quota-exhausted-all-agents exits `2` from the v2 CLI (matching v1's documented exit `2`). Rationale: operator muscle memory; same telemetry would be wrong here, but exit codes are user-facing.
- Decision: model-configuration errors exit `3` and never trigger fallback (matching v1). Rationale: same as above; classification rules are ported with the signals.
- Decision: subcommand name is the drafter's call but must be a single word verb matching the behavior vocabulary (e.g. `write`); no `run`, no `exec`, no Phase-labeled name. Rationale: keeps "no planning labels in code" honest and lines up with v2-architecture behavior naming.
- Decision: argv shape minimum is `<subcommand> <spec-path>` with optional `--branch <name>`, `--worktree-root <path>` (test seam for `~/.jarvis/worktrees`), `--repo <ref>` (matches v1's `--repo`), and `--config <path>` (test seam for config file). Rationale: each flag has a concrete first consumer (tests or operator override); no speculative flags.
- Decision: CLI exit-code table is published in the new v2 doc and is: `0` done+contract-pass / `0` no-work+contract-pass, `1` generic error, `2` quota-exhausted-all-agents, `3` model-configuration error, `4` blocker outcome, `5` contract-fail blocker, `6` `progress` returned without a loop, `9` worktree locked, `130` aborted. Rationale: distinct codes per stop reason are the only structured signal a non-daemon CLI has; matches v1 where overlap exists.
- Decision: `~/.jarvis/worktrees` root is computed as `path.join(homedir(), ".jarvis", "worktrees")` in the CLI host and overridable by `--worktree-root`; the core takes the resolved absolute path as input. Rationale: keeps `homedir()` out of the core; explicit override unblocks tmp-dir tests.
- Decision: prompt registry in Phase 1 is a single-file in-memory `Map<id, PromptDefinition>` populated at module load with exactly one entry: the `write` step prompt. Rationale: smallest registry that proves the lookup-by-ID seam; no filesystem scan, no frontmatter parser yet.
- Decision: the registered `write` prompt instructs the agent on (a) how to choose the next unchecked subspec from the spec path it received, (b) the outcome-sentinel format, and (c) the blocker prose convention. Rationale: contract-vs-prompt coupling lives in one file in Phase 1; future fragments split it.
- Decision: prompt rendering is naive string interpolation of declared placeholders (`spec_path` minimum) with hard failure on missing required values; no fragments, no overrides, no snapshot tests. Rationale: avoids cloning `v2/docs/prompts.md` architecture before its first multi-step consumer (Phase 5).
- Decision: tests use a `FakeAgentInvoker` that takes a script of `(prompt, signal) => { outcome, stdout, exitCode }` and runs in-process; subprocess shape is exercised by a separate adapter test that spawns a tiny inline shell script per supported CLI shape. Rationale: keeps the core's end-to-end test deterministic and fast; subprocess concerns isolated to one test file.
- Decision: at least one test spawns a real subprocess and asserts the SIGINT→SIGTERM→SIGKILL escalation cancels it within timeout. Rationale: this is the only way to prove the abort plumbing; mock-only tests can't.
- Decision: tests run against a fresh `git init` repo in `tmpdir()` with one commit on the default branch and a fixture spec file; no fixtures depend on this jarvis repo. Rationale: deterministic, hermetic, parallel-safe.
- Decision: telemetry, log-server, and `runs.jsonl` are explicitly not written by v2 in Phase 1; the CLI prints a single-line human-readable result and exits. Rationale: Phase 2/3 own those surfaces; writing them now would invent schemas with no reader.
- Decision: v2 does not create a PR, push, or commit; on success, stdout ends with `worktree: <abs path>` so operators can `cd` in and `git diff`. Rationale: matches the Phase 1 no-PR / no-push non-goal with one concrete operator affordance.
- Decision: new v2 doc lands at `v2/docs/write-command.md` (drafter may rename) covering: command shape, exit-code table, outcome semantics, contract definition, worktree path computation, lock cohabitation, ported-quota provenance. Rationale: durable home per `v2/docs/documentation-standard.md` "operator/workflow behavior" + "component contracts spanning files".
- Decision: `README.md` v2 section update is minimal — add the new subcommand line and link to `v2/docs/write-command.md`. Rationale: terseness; full contract lives in the doc.
- Decision: `v2/docs/v2-architecture.md` §Output contract gets a one-paragraph addendum noting that Phase 1 picked the acceptance-criteria-transition primitive as the seed and that the full vocabulary remains open. Rationale: keeps architecture and shipped reality aligned; avoids a stale "to design later" line.
- Decision: cross-tree import-boundary test added in Phase 0 must keep covering `v2/src/agents/quota.ts` (no `v1/**` imports) after the port lands. Rationale: ported code is the most likely accidental-import surface.
- Deferred to first consumer: whether the v2 CLI should accept a directory (index.md auto-discovery) in addition to a file path — pin when the loop (Phase 2) needs to walk the index.
- Deferred to first consumer: per-step prompt fragment inheritance, prompt revision/snapshot infrastructure, and adapter wrappers from `v2/docs/prompts.md` — pin when Phase 5's workflow runner exists.
- Deferred to first consumer: structured outcome metadata (token usage, cost) for v2 — pin when Phase 3's structured log stream consumes them.
- Risk: porting quota patterns can drift from v1 as v1 captures real stderr samples (`v1/docs/quota-signals.md`). Mitigation: the source-SHA comment makes re-sync a mechanical chore; re-sync is not Phase 1 work but is called out for future phases.
- Risk: outcome sentinel parsing collides with agent output that happens to contain the sentinel string. Mitigation: drafter picks a sentinel improbable in agent transcripts (UUID-suffix or HTML-comment with namespace), and tests include a "sentinel inside a code block" case.
- Risk: SIGINT during git worktree creation leaves a half-created worktree. Mitigation: core wraps worktree creation in a guard that runs `git worktree remove --force <path>` on abort before re-raising; covered by an abort-during-setup test.
- Constraint: every file added in Phase 1 lives under `v2/src/**` or `v2/docs/**` or top-level `README.md`; touching `v1/src/**` or `v1/docs/**` is a review-blocking violation. Re-stated because the import boundary alone doesn't catch doc edits.
- Constraint: subspec PRs must each pass `bun run ready` independently; no PR may depend on a later PR to make CI green. Rationale: matches AGENTS.md "one independently reviewable change per subspec".
- Assumption: `gh` is available and authenticated on the operator's machine for default-branch resolution; if not, v2 falls back to `git symbolic-ref refs/remotes/origin/HEAD` and surfaces a clear preflight error if both fail. Rationale: same posture as v1's `gh auth` preflight without porting v1's preflight module.
- Assumption: the operator runs the v2 CLI from any cwd; the spec path may be relative or absolute, resolved against `process.cwd()` in the host before being handed to the core as an absolute path. Rationale: matches v1 `jarvis1 run` behavior; keeps cwd out of the core.
- Decision: v1 lock JSON has exactly the keys `pid`, `started_at`, `host` (see `v1/src/worktree-lock.ts:12`). v2 writes the same three keys plus an additive `agent: "v2"` (and may add `model` if cheap). Rationale: v1 reads via `JSON.parse` with no schema check, so additive fields are tolerated; missing required fields would crash v1.
- Decision: v2 also adds `.jarvis.lock` to the worktree's `info/exclude` exactly as v1 does (`ensureLockExcluded` in `v1/src/worktree-lock.ts:35`). Rationale: prevents accidental `git add -A` staging if v2 ever commits inside the worktree in later phases; cost is zero and keeps behavior symmetric with v1.
- Decision: project-key resolution (registered project lookup for the worktree path segment) happens in the CLI host, not the core. The host resolves `<project>` to a final string and passes the absolute worktree path into the core. Rationale: config read is fs/host concern; matches the grep-checkable "no `process.env`/`process.cwd`/fs read in core" acceptance signal.
- Decision: `--worktree-root` overrides the entire `~/.jarvis/worktrees` segment; `<project>/<branch>` is still appended by the host. Rationale: tests need a tmp root but should still exercise the project/branch path layout.
- Decision: when the agent's reported outcome is `no-work` but the contract verifier observes one or more `- [ ]` → `- [x]` transitions, treat as contract pass and log a single stderr warning `outcome no-work but N criteria advanced; treated as done`. Rationale: avoids penalizing an honest agent for an accurate token mismatch; logs the inconsistency for future prompt tuning.
- Decision: the full agent stdout and stderr from each attempt are written to a per-attempt file under `<worktree>/.jarvis/attempts/<iso-timestamp>-<agent>.log` and the path is printed on stderr at the end of the run. Rationale: operators debugging a blocker need the raw transcript; this is the v2 equivalent of v1's session log without inventing the log-server schema.
- Decision: attempt log files are ignored via `info/exclude` alongside `.jarvis.lock`. Rationale: same reason — never accidentally stage transient diagnostics.
- Decision: on quota fallback, each rotated agent gets its own attempt log file; the CLI's final line lists all attempt log paths in order. Rationale: a quota-exhausted-all run has N transcripts and the operator needs all of them.
- Decision: the `--repo` flag accepts the same forms as v1 (`<name|path|url>`) and resolves identically (registered project key, origin URL match, local path). Rationale: avoid surprise for operators switching between `jarvis1 run` and `jarvis write`.
- Decision: when `--repo` is omitted, v2 resolves the target repo from the spec's `repo:` line (if present) or by walking the spec path upward to a git checkout, in that order. No prompt; absent both ⇒ exit `1` with `cannot resolve target repo`. Rationale: v2 is non-interactive in Phase 1 (no TTY prompt); matches "no daemon, no IPC" posture.
- Decision: v2 ignores `modes.patch.agentOrder` entries with an unsupported `agent` value (anything outside `claude|codex|cursor|opencode|aider`) by exiting `3` (model-config error class) before any invocation. Rationale: silently skipping a configured agent would mask config typos; matches v1's posture toward unknown agents.
- Decision: process-group cancellation (`detached: true` + `process.kill(-pgid, ...)`) is POSIX-only; v2 explicitly documents Windows as unsupported in `v2/docs/write-command.md` and exits `1` with `unsupported platform` on `process.platform === "win32"`. Rationale: jarvis is darwin/linux already (see env header); declaring it keeps the abort plumbing simple.
- Decision: when `git: false` is set in config, the v2 `write` subcommand exits `1` with `v2 write requires git: true (Phase 1)`. Rationale: the entire walking skeleton is worktree-based; supporting no-git mode is undefined here and forcing operator awareness avoids silent path divergence.
- Decision: when `modes.plan.commit: false` produced the spec under `~/.jarvis/specs/...`, v2 still operates on it — it reads the spec from that absolute path and writes the worktree under `~/.jarvis/worktrees/<project>/<branch>/` against the repo resolved from the spec's `repo:` line. Rationale: external-spec compatibility costs nothing here and matches v1's `jarvis1 run` symmetry.
- Decision: `gh` preflight (auth + default-branch resolution) runs once at the start of the CLI host before any worktree mutation; failure modes are: (a) `gh` missing entirely ⇒ fall back to `git symbolic-ref refs/remotes/origin/HEAD`; (b) both fail ⇒ exit `1` with `cannot determine default branch (gh and git both failed)`. Rationale: fail fast before half-creating a worktree.
- Decision: the spec path argument must point to a file (not a directory) in Phase 1; passing a directory exits `1` with `spec path must be a file; directory auto-discovery lands in Phase 2`. Rationale: matches the deferred-to-first-consumer entry above; makes the deferral observable to operators rather than silent.
- Constraint: the per-attempt log directory `<worktree>/.jarvis/` must not collide with any existing v1-owned path in the worktree. v1 currently only writes `.jarvis.lock` at the worktree root, so `.jarvis/` as a directory is free. Rationale: forward-compat with v1 changes — drafter should grep `v1/src/**` once before locking the name in.
- Risk: v1's lock file uses `started_at` (snake_case) while v2 idioms favor camelCase. Mitigation: byte-compatibility wins; v2 reads/writes the v1 snake_case keys and only camelCases its own additive fields. Tested by writing a v2 lock and parsing it with v1's `acquireWorktreeLock` in a cross-boundary integration test (the one place the import boundary is intentionally relaxed for test fixtures, or duplicate the parser inline if the boundary forbids even that).
- Deferred to first consumer: whether the cross-boundary lock-compat test imports v1 code or duplicates the parser — pin when the test is written; if forbidden, duplicate. Rationale: the import-boundary rule predates this need and may need a narrow test-only exception.
- Assumption: spec basename has the form `<timestamp>-<slug>` or just `<slug>`. Branch derivation strips a leading `YYYY-MM-DDTHH-mm-ssZ-` prefix if present, else uses the basename verbatim. Rationale: matches `v1/docs/spec-guidance.md` "timestamp prefix is filesystem-only, not part of the branch".
- Assumption: `bun run ready` already covers `typecheck`, `check`, `test`, and lint; Phase 1 PRs do not need to invent a new CI command. Rationale: matches `AGENTS.md` "Flip draft→ready with `bun run ready`".
- Decision: the cross-tree import boundary enforcer is the Phase 0 **Biome** `noRestrictedImports` override (runs under `bun run check`), not a tsconfig rule. The Phase 1 quota port adds `v2/src/agents/quota.ts` to whatever globs the existing Biome override already covers, and the existing Phase 0 import-boundary test continues to assert no `v1/**` import resolves from v2. Rationale: drafter must wire the new file into the existing Biome rule, not invent a new mechanism.
- Decision: v2's lock writer must produce byte-identical serialization to v1's `writeFileSync(lockPath, ` `${JSON.stringify(lock, null, 2)}\n`, "utf8")` (`v1/src/worktree-lock.ts:115`): two-space indent, trailing newline, key order `pid`, `started_at`, `host`, then any additive v2-only keys appended. Rationale: byte-compat is the stated cohabitation contract; key-order divergence on its own won't break v1 but makes diffing two harnesses' locks needlessly noisy.
- Decision: v2 resolves the per-worktree exclude file via the same `git rev-parse --git-path info/exclude` call v1 uses (`v1/src/worktree-lock.ts:38`), not a hardcoded `.git/info/exclude` path. Rationale: linked worktrees keep their gitdir under the main checkout's `worktrees/<name>/`, so the hardcoded path would silently fail and re-stage `.jarvis.lock` later.
- Decision: argv dispatch in the v2 CLI host must treat `argv.length === 0`, `argv === ["--version"]`, and `argv[0] === "<subcommand>"` as three disjoint branches; the existing `v2 not ready` / `--version` paths in `v2/src/cli.ts:14–20` keep their exact stdout strings and exit-0 behavior. Rationale: Phase 0 tests in `v2/src/cli.test.ts` assert those exact strings; breaking them blocks the PR before any Phase 1 test runs.
- Decision: the new subcommand is invoked as `jarvis <subcommand> <spec-path>` via the root `bin/jarvis` shim (not `jarvis1`); `bin/jarvis1` and all `jarvis1 <verb>` commands remain v1-only and untouched. Rationale: README and `bin/` shims already wire it this way; making it explicit pre-empts the drafter shipping `jarvis1 write`.
- Decision: per-attempt log filename uses the same `:`→`-` ISO-timestamp substitution v1 uses for spec directories (`2026-05-23T23-17-59Z` style), not raw `toISOString()`. Rationale: `:` in filenames breaks on case-insensitive/FAT-derived filesystems and confuses some shells; v1 already standardized on the substituted form so v2 should match.
- Constraint: the Phase 1 subspec that lands the write subcommand must also remove or amend the `v2 not ready` assertion in `v2/src/cli.test.ts` only for the new subcommand path; the no-arg and `--version` assertions stay intact. Rationale: drafter risks deleting the whole file when extending it; the scope is additive plus one narrow edit.
