# Split test slices and relocate ownership

## Decisions

- Keep `test` as the full-repo entrypoint; making `test:all` the only aggregate command is the wrong alternative.
- Add `test:v1`, `test:v2`, and `test:shared` as simple owner-directory commands; keeping ownership-aware filters over a mixed `v1/test/` tree is the wrong alternative.
- Move repo-root/shared-owned tests out of `v1/test/` into the owning tree; leaving mis-owned tests in place and routing around them is the wrong alternative.

## Tasks

- Add root `test:v1`, `test:v2`, `test:shared`, and aggregate `test` scripts.
- Relocate mis-owned tests so each of `v1`, `v2`, and `shared` owns its test directory.
- Add regression coverage for script names and slice routing.

## Documentation updates

- Update `v2/docs/v1-behaviors.md` with the root test-command contract and `shared` slice boundary.

## Acceptance criteria

- [ ] Root `package.json` exposes runnable `test:v1`, `test:v2`, `test:shared`, and aggregate `test` scripts.
- [ ] No root/shared-owned tests remain under `v1/test/`; each `test:*` command resolves by its owner's test directory.
- [ ] The aggregate `test` script runs the full required suite across v1, v2, and shared slices.
- [ ] Automated tests fail on script-name or slice-routing regressions.
- [ ] `v2/docs/v1-behaviors.md` records the operator-facing test-command contract and shared-slice ownership rule.
