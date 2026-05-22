# 01 - CODEOWNERS

## Problem

Before wider sharing, every change should default-review to the maintainer so
nothing lands unnoticed.

## Decisions

- **Path**: repository root `CODEOWNERS` (GitHub documents this file at the repo
  root or in `.github/CODEOWNERS`).
- **Pattern**: `*` owned by `@cbrenner04` so all files match unless narrowed
  later.

## Tasks

- [x] Add `CODEOWNERS` at the repo root with the wildcard owner line.
- [x] Confirm the syntax matches [GitHub CODEOWNERS
      rules](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

## Acceptance criteria

- New PRs automatically request review from the listed owner(s) according to
  GitHub’s CODEOWNERS behavior for this repo.

## Documentation updates

- [x] In [../../README.md](../../README.md), mention that PRs use `CODEOWNERS`
      for default reviewers when sharing the repo.
