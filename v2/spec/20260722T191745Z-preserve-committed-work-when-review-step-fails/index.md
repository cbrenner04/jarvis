# Preserve committed work when a review step times out

repo: cbrenner04/jarvis

A review role that exceeds its wall-clock bound settles the run `failed` / non-resumable /
`nextAction: "stop"`, stranding an implementation the write step already committed and the
adjudicated verdict that preceded the actuator. Make the timeout-triggered settle preserving and
retryable; leave every other review failure as it is.

- [x] [00 - Settle a timed-out review step as retryable, preserving the commit and verdict](./00-timed-out-review-settles-retryable.md)
