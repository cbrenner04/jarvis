# Split test slices and relocate ownership

## Decisions

- Keep `test` as the full-repo entrypoint; making `test:all` the only aggregate command is the wrong alternative.
- Add `test:v1`, `test:v2`, and `test:shared` as simple owner-directory commands; keeping ownership-aware filters over a mixed `v1/test/` tree is the wrong alternative.
- Treat repo-root/shared-owned tests as the `shared` slice and move any such cases out of `v1/test/`; leaving mis-owned tests in place and routing around them is the wrong alternative.

## Tasks

- Add root scripts for `test:v1`, `test:v2`, `test:shared`, and the aggregate `test` path.
- Relocate root/shared-owned tests now living under `v1/test/` into their owning tree so each tsconfig project owns its own test directory.
- Keep `test:v1` scoped to v1-owned tests after relocation rather than carrying temporary shared exceptions in the aggregate only.
- Add regression tests that fail when script names or per-slice routing drift.

## Documentation updates

- Update `v2/docs/v1-behaviors.md` with the root test-command contract and the current `shared` slice boundary.

## Acceptance criteria

- [ ] Root `package.json` exposes runnable `test:v1`, `test:v2`, `test:shared`, and aggregate `test` scripts.
- [ ] No root/shared-owned tests remain under `v1/test/`; each of `v1`, `v2`, and `shared` owns the tests its `test:*` command runs by directory.
- [ ] The aggregate `test` script runs the full required suite across v1, v2, and shared slices.
- [ ] Automated tests cover the script wiring and fail on command-name or slice-routing regressions.
- [ ] `v2/docs/v1-behaviors.md` records the operator-facing test-command contract and the shared-slice ownership rule.
