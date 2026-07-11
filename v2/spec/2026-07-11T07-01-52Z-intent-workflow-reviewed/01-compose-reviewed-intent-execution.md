# Compose reviewed intent execution

Extend the intent builder with bounded light review before the existing safe landing boundary.

## Decisions

- `reviewPasses` defaults to `1`; rules out requiring every caller to construct the standard reviewed posture.
- `reviewPasses: 0` builds the existing one-step `intent` workflow; rules out dispatching a zero-cycle review step.
- Positive passes add one light `review` step with `maxCycles` equal to the requested count; rules out expanding passes into multiple review steps with separate state.
- The critic receives rendered `intent.prompt.review`; the actuator receives rendered `intent.prompt.review-actuator` plus the critic verdict; rules out verdict-only actuator invocation that omits the governed editing boundary.
- Place the verdict beside `.jarvis-intent-stage/` and outside `ready-intents/`; rules out treating reviewer control data as authored output.
- Land and publish only after the review step completes; rules out exposing pre-review staged files or publishing after review failure.

## Tasks

- Accept and validate an explicit non-negative integer review-pass count in the intent builder.
- Build the intent-specific critic/actuator review step with configured per-role bindings and the sibling verdict path.
- Reuse the existing intent validator, transactional landing, and completion publisher after successful review.
- Cover zero, default, bounded multi-pass, failure, git-enabled, and git-disabled execution.

## Acceptance criteria

- [ ] The reviewed builder defaults to split plus one light critic/actuator cycle using the intent-specific governed prompts and configured role bindings; the actuator input retains the critic verdict.
- [ ] A requested positive pass count runs at most that many cycles and rejects negative, fractional, or non-numeric values before daemon start.
- [ ] Zero review passes produces the existing split-only `intent` step shape and performs no critic or actuator invocation.
- [ ] The verdict is a sibling of `.jarvis-intent-stage/` and never lands under durable `ready-intents/`.
- [ ] Critic or actuator failure/non-completion prevents landing, commit, push, PR publication, and git-disabled durable output.
- [ ] Successful reviewed runs land only validated post-review intents and retain existing git-enabled and git-disabled destinations and publication semantics.
- [ ] `v2/docs/workflow-runner.md` documents composition, pass bounds, zero-pass behavior, verdict placement, and the safe completion boundary.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with reviewed composition and completion semantics.
