# 01 — v1 source string updates

Update every user-facing `jarvis` command string in the v1 TypeScript source to `jarvis1`. This covers usage text, error prefixes, actionable command suggestions, status output, and generated next-step messages. Data-namespace strings (`namespace: "jarvis"`, `~/.jarvis/` paths, git trailers, PR narrative markers) are explicitly excluded.

## Decisions

- Update only strings that a user reads as a command they can run or an error prefix that identifies the CLI. Do not update internal keys, config paths, telemetry namespaces, or protocol markers.
- All fifteen files below are in scope. Any file not listed is out of scope.

## Files in scope

**From Refine turn 1:**
1. `v1/src/cli.ts` — `USAGE` string, `"jarvis: ..."` error prefixes
2. `v1/src/commands/plan.ts` — `PLAN_USAGE`, worktree triage suggestion, no-commit next-step message, plan-complete handoff messages (`jarvis plan --resume`, `jarvis run spec/...`)
3. `v1/src/log-server-preflight.ts` — `"jarvis: log server unreachable..."` prefix, `` `jarvis log-server` `` suggestion
4. `v1/src/modes/patch/run.ts` — `` `jarvis run` `` plan-branch-exists warning
5. `v1/src/commands/triage.ts` — `"jarvis cleanup"` and `"jarvis run"` action suggestions

**From Refine turn 2:**
6. `v1/src/modes/shared-entry.ts` — `"jarvis: log server unreachable..."`, `` `jarvis log-server` ``, `` `jarvis init` `` suggestions
7. `v1/src/worktree.ts` — `` `jarvis cleanup` `` in thrown-error message (line ~106); JSDoc comment mentioning `jarvis triage` is NOT updated
8. `v1/src/commands/init.ts` — `"jarvis: init must be run inside..."`, `` `jarvis config` `` suggestion, `"jarvis: ${err}"` prefix
9. `v1/src/commands/review-feedback.ts` — all `"jarvis review-feedback: ..."` error/status prefix strings
10. `v1/src/logging.ts` — `"jarvis: invalid logServerBind..."`, `"jarvis: log server failed: ..."`, `"jarvis log-server listening on..."` (do NOT rename `namespace: "jarvis"` on line ~22)

**From Refine turn 3:**
11. `v1/src/commands/config.ts` — `USAGE` string, sixteen `"jarvis: ..."` error prefixes covering every config subcommand
12. `v1/src/commands/prices.ts` — `USAGE` string, `"jarvis: unknown prices subcommand..."` error
13. `v1/src/commands/prices-edit.ts` — `"jarvis: ..."` error prefixes
14. `v1/src/commands/prices-show.ts` — `"jarvis: failed to load prices: ..."` error
15. `v1/src/disambiguation-prompt.ts` — `"jarvis: ..."` error prefixes for invalid-choice errors

## Do NOT change

- `namespace: "jarvis"` in `plan.ts` (telemetry/session key)
- `namespace: "jarvis"` in `logging.ts` (data-namespace key)
- `~/.jarvis/` path strings throughout
- Git trailer values, PR narrative markers, internal protocol strings
- JSDoc/code comments (non-user-facing)

## Task checklist

- [ ] Update `v1/src/cli.ts`
- [ ] Update `v1/src/commands/plan.ts`
- [ ] Update `v1/src/log-server-preflight.ts`
- [ ] Update `v1/src/modes/patch/run.ts`
- [ ] Update `v1/src/commands/triage.ts`
- [ ] Update `v1/src/modes/shared-entry.ts`
- [ ] Update `v1/src/worktree.ts` (thrown-error only, not JSDoc)
- [ ] Update `v1/src/commands/init.ts`
- [ ] Update `v1/src/commands/review-feedback.ts`
- [ ] Update `v1/src/logging.ts` (skip `namespace:` line)
- [ ] Update `v1/src/commands/config.ts`
- [ ] Update `v1/src/commands/prices.ts`
- [ ] Update `v1/src/commands/prices-edit.ts`
- [ ] Update `v1/src/commands/prices-show.ts`
- [ ] Update `v1/src/disambiguation-prompt.ts`

## Acceptance criteria

- [ ] No user-facing `"jarvis "` or `` `jarvis `` strings remain in any of the fifteen listed source files (verified by grep; data-namespace occurrences such as `namespace: "jarvis"` and `~/.jarvis` are excluded from this check)
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Documentation updates

No documentation changes in this subspec. README and docs are updated in subspec 03.
