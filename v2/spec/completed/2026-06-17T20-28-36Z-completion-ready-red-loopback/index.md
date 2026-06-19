# Red completion `ready` loops back instead of erroring the run

repo: https://github.com/cbrenner04/jarvis

Changes existing patch-mode completion behavior (logs `v2/docs/v1-behaviors.md`).
Implementation is v1 harness work (`v1/src/modes/patch/run.ts`,
`v1/src/modes/patch/review.ts`, `v1/src/modes/patch/shrink.ts`,
`v1/src/modes/patch/pr.ts`, `v1/src/ready-gate.ts`, `v1/docs/**`,
`v2/docs/v1-behaviors.md`). Not `v2/src`. See `intent.md`.

Subspecs are ordered; each builds on the prior:

- [x] [00 - Completion `ready` gate before shrink/review](./00-completion-ready-gate.md)
- [x] [01 - Loop the red completion gate back into one fix-up iteration](./01-red-loopback-iteration.md)
- [x] [02 - Stuck-red completion stop (exit `10`)](./02-stuck-red-stop.md)
