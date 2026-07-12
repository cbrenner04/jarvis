# 01 - v2 plan draft write step uses the shared builder

`executePlanDraftWrite` (`v2/src/execution/write.ts`) renders the `plan.prompt.draft` artifact body straight from the registry — no fragment assembly, no delimiter enforcement, and neither the file-output instructions nor the write-loop step-completion rules that `intent.prompt.split` receives. Agents dump spec prose to stdout and the write loop fails `invalid_token`. Route the step through `buildPlanDraftPrompt` from `00`, passing the resolved spec directory and the step's `stepRules`.

## Decisions

- Fix the prompt contract, not the token parser — rules out loosening `invalid_token` handling or accepting prose terminations.
- v2 adopts full fragment assembly (global + plan behavior fragments ahead of the artifact body), matching v1 and `intent.prompt.split` — rules out preserving today's body-only render, which is the same bug in a second place.
- The prompt's file-output target is the absolute worktree-resolved spec directory — the same value the write-loop completion validator checks — rules out naming the repo-relative `<targetDir>/<NAME>/` form the agent's cwd may not resolve identically.
- The builder's delimiter-violation throw is caught in `executePlanDraftWrite` and returned as a `model_config`-class step failure (terminal, not retried, not an unhandled crash) — rules out letting a new throw escape into the write loop as an unclassified error.
- `stepRules` is the step payload's string (`DEFAULT_WRITE_STEP_RULES` on the plan path) passed through verbatim — rules out hardcoding the terminal-token sentence in the builder.

## Out of scope

- `executePlanDraftWrite` rewrites `intent.md` from the seed on every write-loop iteration. Today the step dies on iteration 1 so it never bites; once iterations proceed, an agent-appended `## Blocker` is erased by the next iteration. Seen and deferred — distinct behavior change with its own contract implications, separate intent.

## Task checklist

- [ ] `executePlanDraftWrite` builds its prompt with `buildPlanDraftPrompt`, supplying `specDir` and `args.stepRules`; drop the local registry/`renderArtifactTemplate` rewrite path.
- [ ] Classify the builder's delimiter throw as a `model_config` step failure.
- [ ] Extend `v2/src/execution/write.test.ts` coverage for the rendered plan-draft prompt and an end-to-end write-loop pass.

## Acceptance criteria

- [ ] The prompt sent for a `plan.prompt.draft` write step carries the assembled plan behavior fragments, not just the artifact body, plus the intent seed and spec guidance.
- [ ] That prompt contains file-output instructions naming the absolute resolved spec directory (write `index.md` plus numbered subspecs there, do not emit spec content to stdout) — the same directory the write-loop completion validator checks.
- [ ] The step payload's `stepRules` string appears verbatim in the rendered prompt's step-completion section.
- [ ] A delimiter-violating intent seed makes the plan-draft write step fail as `model_config` rather than throwing out of the executor.
- [ ] Driving a plan-draft write step through the write loop with a stubbed agent that writes `index.md` plus a subspec into the resolved spec directory and emits the done token completes the step successfully.
- [ ] `v2/src/execution/write.test.ts` plan-draft blocker and `plan.draft.shape` contract tests stay green (contracts unchanged by the prompt change).

## Documentation updates

- `v2/docs/prompts.md` — record that `plan.prompt.draft` write-loop steps get the full fragment assembly plus runtime file-output and step-completion suffixes appended outside the registry artifact, same pattern as `intent.prompt.split`.
