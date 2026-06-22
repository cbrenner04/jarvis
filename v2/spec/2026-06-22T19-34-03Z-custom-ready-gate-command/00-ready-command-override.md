# Per-project `readyCommand` override

## Problem

The patch completion ready gate hardcodes `bun run ready`. A target repo whose verification command
differs (or whose script isn't named `ready`) fails the gate every iteration, with no way to point it
at the repo's real command. Let a registered project configure an alternate command that replaces
`bun run ready` at every gate call site; repos that set nothing are unchanged.

## Decisions

- Config location: per-project `projects.<name>.readyCommand` string only; no global/patch-mode default — the default `bun run ready` is jarvis-specific and each repo's real command differs, so one global value cannot serve multiple repos.
- Execution: tokenize the command on whitespace (head + args) and run via `execFileSync` with no shell, mirroring `bun run ready` and `updateSnapshotsCommand` — a shell-interpreted string would diverge from that pattern and add quoting/injection surface.
- Tier signal: the configured command runs with `JARVIS_READY_TIER` exported (selected `fast`/`full`), same as `bun run ready`; tier selection and reuse logic are unchanged — dropping the env for custom commands would silently deny custom scripts the fast/full signal.
- Resolve the project's `readyCommand` once from `preflight.cfg.projects[preflight.project.key]` (mirroring `updateSnapshotsCommand` resolution) and thread it as an optional `readyCommand` seam through `runReadyAndCommit` / `runReadyGateWithTier` to every gate call site — re-resolving config at each of the five sites would duplicate lookup logic.
- Unset field, and ad-hoc (unregistered) runs with no project entry, both run `bun run ready` verbatim — opt-in, default-off.

## Task checklist

- [ ] Add `readyCommand?: string` to the `Project` type and validate it in `validateConfig` (non-empty string; reject empty/whitespace/non-string); add it to the strict project allowed-key set.
- [ ] Parametrize `runReadyAndCommit` / `runReadyGateWithTier` with an optional `readyCommand`; when present the real runner tokenizes and `execFileSync`-runs it (with `JARVIS_READY_TIER`) instead of `bun run ready`, and the failure error names the configured command.
- [ ] Resolve the project's `readyCommand` where `preflight.cfg`/project key is available and thread it to the completion, pre-shrink, review-baseline, review-final, and `maybeMarkReady` gate calls.
- [ ] Documentation updates below.

## Acceptance criteria

- [ ] A registered project with `readyCommand` set runs that command in place of `bun run ready` at every gate site: completion transition, pre-shrink gate, review baseline, review final, and `maybeMarkReady`.
- [ ] The configured command is invoked with `JARVIS_READY_TIER` set to the selected tier (`fast` or `full`), and tier selection / green-carrier reuse behavior is unchanged.
- [ ] When the gate runs `full` and leaves the tree dirty, the existing `check:fix` commit (`Jarvis-Agent` trailer) and push still run; when the configured command exits non-zero the PR is left draft and the surfaced failure includes the command's captured output and names the configured command.
- [ ] `validateConfig` rejects a `readyCommand` that is empty, whitespace-only, or non-string, and rejects unknown project keys while accepting `readyCommand`; a config with `readyCommand` round-trips through load/write unchanged.
- [ ] A project with no `readyCommand`, and an ad-hoc (unregistered) run, both invoke `bun run ready` exactly as before — existing `ready-gate` and gate-call-site tests stay green (behavior unchanged when unset).

## Documentation updates

- [ ] `v1/docs/config.md`: document `readyCommand` (per-project, optional; replaces `bun run ready` at all patch ready-gate sites; tokenized, no shell; receives `JARVIS_READY_TIER`) and add it to the strict project-key list.
- [ ] `v2/docs/v1-behaviors.md`: record that the patch ready gate runs a per-project `readyCommand` when set (else `bun run ready`) across all gate sites, with `JARVIS_READY_TIER` and `check:fix`/commit/push behavior unchanged — this changes existing ready-gate behavior.
- [ ] Update any `v1/docs` ready-gate description (e.g. `run-loop.md`) that states the gate runs `bun run ready` to note the per-project override.
