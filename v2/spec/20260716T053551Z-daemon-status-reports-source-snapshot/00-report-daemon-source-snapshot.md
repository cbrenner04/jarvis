# 00 - Report daemon source snapshot

Make `jarvis daemon status` identify and compare the daemon's startup revision with the invoking CLI revision.

## Decisions

- Use the full Git `HEAD` commit as the source revision; rules out package versions, abbreviated hashes, or dirty-worktree fingerprints.
- Resolve revisions from the Jarvis source checkout, not the operator cwd or target project; rules out unrelated repository revisions.
- Capture the daemon revision once at startup and retain it for the process lifetime; rules out recomputing identity after checkout changes or hot-swapping loaded code.
- Print `running loaded=<revision> current=<revision>` for a match and `stale loaded=<revision> current=<revision>` for a mismatch; rules out JSON, multiline output, or an unlabeled revision.
- Exit `0` only for a matching running daemon; exit `1` for stale or stopped states, preserving stopped detection rather than classifying absence as stale.

## Tasks

- Capture the source revision used by daemon startup and expose it through the daemon status boundary without weakening lifecycle liveness checks.
- Resolve the invoking CLI's source revision, compare it with the loaded revision, and render the matching, stale, and stopped contracts.
- Keep non-status daemon and TUI behavior compatible with the enriched status response.
- Update `v2/docs/write-behavior.md` with status output and exit semantics.
- Update `v2/docs/daemon-host.md` with the startup-snapshot identity and lifetime boundary.
- Update `v2/docs/v1-behaviors.md` with the v2-only daemon status behavior.

## Acceptance criteria

- [ ] A running daemon with the same loaded and current full Git revision prints `running loaded=<revision> current=<revision>` and exits `0`.
- [ ] A running daemon with different loaded and current revisions prints `stale loaded=<loaded-revision> current=<current-revision>` and exits `1`.
- [ ] A missing, dead, or unreachable daemon still prints `stopped` and exits `1` without reporting a stale comparison.
- [ ] The daemon reports the revision captured at startup for its lifetime even if the checkout revision later changes; it does not reload source for in-flight work.
- [ ] `v2/src/daemon/daemon-lifecycle.test.ts` and `v2/src/cli.test.ts` include regression coverage for captured identity plus matching, stale, and stopped status paths that fails against the pre-fix code and passes after implementation.
- [ ] `v2/src/tui/tui-daemon-client.test.ts` stays green with the enriched daemon status response.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` document the shipped status and source-snapshot contracts.
