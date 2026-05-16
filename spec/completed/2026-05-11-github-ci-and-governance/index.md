# GitHub CI and governance

Add continuous integration on GitHub Actions, a root `CODEOWNERS` file so
changes default-review to the maintainer, and (when the GitHub plan allows)
branch protection that requires green CI and code-owner review while keeping
**administrator bypass** enabled so the owner can merge without waiting on checks.

## Subspecs

- [x] [00 - GitHub Actions CI](./00-github-actions-ci.md)
- [x] [01 - CODEOWNERS](./01-codeowners.md)
- [x] [02 - Branch protection via `gh`](./02-branch-protection-via-gh.md)
