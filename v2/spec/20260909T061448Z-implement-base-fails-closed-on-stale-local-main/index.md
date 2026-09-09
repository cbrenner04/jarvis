# `--base main` fails closed on a stale local branch

`implement --base main` materializes from the operator checkout's local `main` without comparing it to `origin/main`; merging via `gh pr merge` never advances the local branch, so the next implement silently re-implements the lane that just merged (#3381).

- [ ] [00 - Refuse admission when the base branch is behind its upstream](./00-refuse-base-behind-origin.md)
