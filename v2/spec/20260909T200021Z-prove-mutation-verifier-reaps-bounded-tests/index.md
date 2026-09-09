# Prove mutation verification reaps bounded killing tests

The real while-true verifier regression proves only elapsed time and classification, so it would still pass if the timed-out `bun test` group survived as an orphan burning a core. Add group-liveness proof to that regression and align the docs.

- [ ] [00-prove-timed-out-killing-test-group-is-gone.md](./00-prove-timed-out-killing-test-group-is-gone.md)
