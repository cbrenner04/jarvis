# Scope cleanup to a registered project

## Problem

`jarvis cleanup` surveys every registered project's managed worktrees, merged branch refs, and open spec home, so closing one session can inspect or mutate another concurrently active project.

## Decision ledger

- Accept `jarvis cleanup [<project>]`; rules out a `--project` flag because cleanup follows the CLI's verb-and-target grammar.
- Validate a supplied project against the registry before daemon discovery, cleanup survey, or mutation; rules out silently cleaning nothing or falling back to all projects.
- Derive one filtered registry for every project-owned cleanup slice, including managed-worktree retirement, merged-branch ref pruning, and stranded-spec archival; rules out independently scoped slices that can drift or leave another project's ref pruning active.
- Keep dead daemon-socket reaping global because sockets are not project-owned; rules out inventing project-to-socket ownership.
- Keep bare `jarvis cleanup` on the all-registered-projects path; rules out requiring a project or changing the default.
- Apply the same project scope under `--dry-run`, `--yes`, and `-y`; rules out preview/apply divergence.
- Reject `jarvis cleanup <project> --abandon <name>` as conflicting targets while preserving bare `jarvis cleanup --abandon <name>`; rules out interpreting the project as either an abandon scope or an ignored operand.
- Preserve all existing eligibility, ref-authority, and archival-ownership rechecks after registry scoping; rules out treating a named project as authorization to weaken cleanup safety gates.

## Tasks

- Update `v2/src/commands/cleanup-cli.ts` to parse zero or one positional project, reject extra or conflicting targets before reading the registry, validate a syntactically admitted named key immediately after reading the registry, derive one scoped registry, and pass it through the existing bulk cleanup orchestration before any daemon or cleanup discovery.
- Keep global dead-socket discovery and reaping independent of the scoped registry; do not add project filters inside individual cleanup slices.
- Add focused CLI tests in `v2/src/commands/cleanup-cli.test.ts` covering two-project preview, interactive confirmation, declined confirmation, and auto-confirmed apply discovery and mutation; bare cleanup; unknown, conflicting, and extra targets; all supported apply/preview flags; global socket reporting/reaping; and the named mutation checkpoints below.
- Update cleanup usage and structured help plus the durable operator and v1-delta documentation listed below.

## Acceptance criteria

- [x] `v2/src/commands/cleanup-cli.test.ts` — `named cleanup scopes project-owned preview and apply to one registered project` uses two registered projects and proves `--dry-run`, accepted interactive confirmation, `--yes`, and `-y` survey or mutate only the named project's managed worktrees, merged branch refs, and open spec home, never call the other project's project-owned discovery or mutation seams, and still reap a dead daemon socket on apply; it fails against the pre-fix positional rejection.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `named cleanup scopes project-owned preview and apply to one registered project`; Keystone checkpoint: its test body carries `// @mutate v2/src/commands/cleanup-cli.ts "const cleanupRegistry = projectName === undefined ? registry : { [projectName]: registry[projectName]! };" -> "const cleanupRegistry = registry;"` and the mutation turns the regression RED by restoring all-project cleanup.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `declined named cleanup leaves the selected project untouched` shows the default confirmation path surveys only the named project's project-owned slices and, on decline, performs no mutation for either project; it fails against unscoped positional cleanup.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `named dry-run reports global dead sockets without reaping them` proves a named `--dry-run` still discovers and reports a dead daemon socket while performing no socket reaping or project-owned mutation.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `bare cleanup keeps every registered project in scope` proves the no-positional form still surveys both registered projects.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `cleanup rejects an unknown project before daemon discovery or cleanup survey` exits nonzero, names the unknown key, and records no socket discovery, daemon connection, subprocess survey, prompt, or filesystem mutation.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `cleanup rejects an unknown project before daemon discovery or cleanup survey`; Mutation checkpoint: its test body carries `// @mutate v2/src/commands/cleanup-cli.ts "if (projectName !== undefined && !Object.hasOwn(registry, projectName)) {" -> "if (false) {"` and the mutation turns the regression RED by allowing downstream discovery.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `cleanup rejects a project combined with abandon before registry access` prints cleanup usage, exits nonzero, records no registry or daemon call, and covers both a registered project and `<unknown> --abandon <name>`; the existing bare `--abandon <name>` path remains covered by `--abandon <name> alone keeps current behavior`.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `cleanup rejects a project combined with abandon before registry access`; Mutation checkpoint: its test body carries `// @mutate v2/src/commands/cleanup-cli.ts "if (projectName !== undefined && abandonName !== undefined) {" -> "if (false) {"` and the mutation turns the regression RED by admitting conflicting syntax before registry validation.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `cleanup rejects more than one positional project before reading the registry` prints cleanup usage, exits nonzero, and performs no registry or daemon call.
- [x] `v2/src/commands/cleanup-cli.test.ts` — `cleanup rejects more than one positional project before reading the registry`; Mutation checkpoint: its test body carries `// @mutate v2/src/commands/cleanup-cli.ts "if (positionals.length > 1) {" -> "if (false) {"` and the mutation turns the regression RED by admitting ambiguous targets.
- [x] Existing safety coverage stays green: `v2/src/commands/cleanup.test.ts` tests `runCleanupCommand rechecks eligibility after confirmation and spares a worktree that went live in the race window`, `guard inversion: ref changed after preview is not deleted`, and `keys stranded ownership to the recorded project branch and rechecks it before archival`.
- [x] `jarvis help cleanup` and cleanup parse errors show `jarvis cleanup [<project>]` with `--dry-run`, `--yes|-y`, and `--abandon <name>`, and state that the positional project and `--abandon <name>` are mutually exclusive while preserving both valid forms.
- [x] `v2/docs/operator-runbook.md` consistently directs concurrent-project session close to `jarvis cleanup <project>` and reserves bare cleanup for intentional all-project maintenance, documents unknown-key refusal, and distinguishes scoped project-owned cleanup from global dead-socket reaping; `v2/docs/v1-behaviors.md` records the changed v2 scope contract.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/src/cli/usage.ts` and structured cleanup help — show `jarvis cleanup [<project>]`, the accepted flags, and that the positional project and `--abandon <name>` are mutually exclusive.
- `v2/docs/operator-runbook.md` — make every session-close imperative prefer the named form during concurrent project activity, reserve bare cleanup for intentional all-project maintenance, define unknown-project refusal, and distinguish the three scoped project-owned slices from global socket reaping.
- `v2/docs/v1-behaviors.md` — record the v2 positional project scope, unchanged bare default and `--abandon` path, and global socket-reaping exception.
