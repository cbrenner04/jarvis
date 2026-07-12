# 01 - v2 plan draft write step uses the shared builder

`executePlanDraftWrite` (`v2/src/execution/write.ts`) renders `plan.prompt.draft` straight from the registry, so the agent gets neither the file-output instructions nor the write-loop step-completion rules that `intent.prompt.split` receives. Agents dump spec prose to stdout and the write loop fails `invalid_token`. Route the step through `buildPlanDraftPrompt` from `00`, passing the resolved spec directory and the step's `stepRules`.

## Decisions

- Fix the prompt contract, not the token parser — rules out loosening `invalid_token` handling or accepting prose terminations.
- Pass the worktree-resolved spec directory as the file-output target (same value the completion validator checks) — rules out instructing the agent with the relative `specPath` the worktree may not resolve identically.
- `stepRules` comes from the step payload (`DEFAULT_WRITE_STEP_RULES` for plan workflows, plus any daemon-appended revise prompt) — rules out hardcoding the terminal-token sentence in the builder.

## Task checklist

- [ ] `executePlanDraftWrite` builds its prompt with `buildPlanDraftPrompt`, supplying `specDir` and `args.stepRules`; drop the local registry/`renderArtifactTemplate` rewrite path.
- [ ] Extend `v2/src/execution/write.test.ts` coverage for the rendered plan-draft prompt.

## Acceptance criteria

- [ ] The prompt sent for a `plan.prompt.draft` write step contains file-output instructions naming the spec directory (write `index.md` plus numbered subspecs there, do not emit spec content to stdout) and a step-completion section carrying the step's `stepRules`.
- [ ] `stepRules` supplied by the step payload appear verbatim in the rendered plan-draft prompt (a revise-appended rule reaches the agent).
- [ ] The rendered prompt still targets `<targetDir>/<NAME>/` (spec-dir rewrite preserved) and still embeds the intent seed and spec guidance.
- [ ] `v2/src/execution/write.test.ts` plan-draft blocker and `plan.draft.shape` contract tests stay green (contracts unchanged by the prompt change).

## Documentation updates

- `v2/docs/prompts.md` — record that `plan.prompt.draft` write-loop steps receive runtime file-output and step-completion suffixes appended outside the registry artifact, same pattern as `intent.prompt.split`.
