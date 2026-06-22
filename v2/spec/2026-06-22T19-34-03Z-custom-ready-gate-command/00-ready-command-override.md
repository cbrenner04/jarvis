# Per-project `readyCommand` override

## Problem

The patch completion ready gate hardcodes `bun run ready`. A target repo whose verification command
differs (or whose script isn't named `ready`) fails the gate every iteration, with no way to point it
at the repo's real command. Let a registered project configure an alternate command that replaces
`bun run ready` at every gate call site; repos that set nothing are unchanged.

## Decisions

- Config location: per-project `projects.<name>.readyCommand` string only; no global/patch-mode default — the default `bun run ready` is jarvis-specific and each repo's real command differs, so one global value cannot serve multiple repos.
- Execution: tokenize the command on whitespace (head + args) and run via `execFileSync` with no shell, mirroring `bun run ready` and `updateSnapshotsCommand` — a shell-interpreted string would diverge from that pattern and add quoting/injection surface. Quoted arguments (e.g. `make ready ARGS='a b'`) are unsupported and tokenize wrong; ruled out shell parsing, which would add the quoting/injection surface this pattern avoids. `validateConfig`'s non-empty rejection is load-bearing for the runner: it guarantees a non-empty head token after tokenization.
- Tier signal: the configured command runs with `JARVIS_READY_TIER` exported (selected `fast`/`full`), same as `bun run ready`; tier selection and reuse logic are unchanged — dropping the env for custom commands would silently deny custom scripts the fast/full signal.
- Fast-tier hazard accepted, not forced to `full`: a `fast`-tier run early-returns before the `check:fix` commit/push and dirty-tree guard, so a `readyCommand` that ignores `JARVIS_READY_TIER` and dirties the tree on a `fast` run leaves it dirty while proceeding toward marking ready. Accepted — custom commands are expected idempotent / clean-on-a-clean-tree, the same assumption already made of `bun run ready`'s `fast` path — to preserve the green-carrier reuse the intent requires unchanged. Ruled out: forcing `full` whenever `readyCommand` is set, which would surrender that reuse for every custom-command repo.
- Plan-mode call site stays unwired: `runReadyAndCommit`'s sixth caller (plan-mode PR handling) keeps `bun run ready` by not passing the override; the override is patch-only. Rules out wiring it plan-side, which is out of scope.
- Resolve the project's `readyCommand` once from `preflight.cfg.projects[preflight.project.key]` (mirroring `updateSnapshotsCommand` resolution) and thread it as an optional `readyCommand` seam through `runReadyAndCommit` / `runReadyGateWithTier` to every gate call site — re-resolving config at each of the five sites would duplicate lookup logic.
- Unset field, and ad-hoc (unregistered) runs with no project entry, both run `bun run ready` verbatim — opt-in, default-off.

## Task checklist

- [ ] Add `readyCommand?: string` to the `Project` type and validate it in `validateConfig` (non-empty string; reject empty/whitespace/non-string); add it to the strict project allowed-key set.
- [ ] Parametrize `runReadyAndCommit` / `runReadyGateWithTier` with an optional `readyCommand`; when present the real runner tokenizes and `execFileSync`-runs it (with `JARVIS_READY_TIER`) instead of `bun run ready`, and the failure error names the configured command.
- [ ] Resolve the project's `readyCommand` where `preflight.cfg`/project key is available and thread it to the completion, pre-shrink, review-baseline, review-final, and `maybeMarkReady` gate calls.
- [ ] Documentation updates below.

## Acceptance criteria

- [ ] A registered project with `readyCommand` set runs that command in place of `bun run ready`, with a test per gate site asserting the configured command is the one invoked: completion transition, pre-shrink gate, review baseline, review final, and `maybeMarkReady` (a missed threading site silently falls back to `bun run ready`, so each site is covered independently).
- [ ] For `maybeMarkReady`, the override propagates through `maybeMarkReady → runReadyGateWithTier` to the actual command invocation — verified at the invocation, not merely that `runReadyGateWithTier` accepts the parameter.
- [ ] The configured command is invoked with `JARVIS_READY_TIER` set to the selected tier (`fast` or `full`), and tier selection / green-carrier reuse behavior is unchanged.
- [ ] When the gate runs `full` and leaves the tree dirty, the existing `check:fix` commit (`Jarvis-Agent` trailer) and push still run; when the configured command exits non-zero the PR is left draft and the surfaced failure includes the command's captured output and names the configured command.
- [ ] `validateConfig` rejects a `readyCommand` that is empty, whitespace-only, or non-string, and rejects unknown project keys while accepting `readyCommand`; a config with `readyCommand` round-trips through load/write unchanged.
- [ ] A project with no `readyCommand`, and an ad-hoc (unregistered) run, both invoke `bun run ready` exactly as before — existing `ready-gate` and gate-call-site tests stay green (behavior unchanged when unset).

## Documentation updates

- [ ] `v1/docs/config.md`: document `readyCommand` (per-project, optional; replaces `bun run ready` at all patch ready-gate sites; tokenized, no shell; receives `JARVIS_READY_TIER`) and add it to the strict project-key list.
- [ ] `v2/docs/v1-behaviors.md`: record that the patch ready gate runs a per-project `readyCommand` when set (else `bun run ready`) across all gate sites, with `JARVIS_READY_TIER` and `check:fix`/commit/push behavior unchanged — this changes existing ready-gate behavior.
- [ ] Update any `v1/docs` ready-gate description (e.g. `run-loop.md`) that states the gate runs `bun run ready` to note the per-project override.
