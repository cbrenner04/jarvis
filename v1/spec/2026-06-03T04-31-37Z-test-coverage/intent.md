---
name: test-coverage
---

# Add useful test coverage measurement

Jarvis needs simple repo-owned coverage visibility for v1, v2, and shared/root
code.

## Desired outcome

Coverage commands produce readable output and durable reports for:

- v1-owned code and tests.
- v2-owned code and tests.
- shared/root-owned code and tests.

## Scope

- Use Bun's built-in `bun test --coverage`.
- Add explicit coverage scripts for v1, v2, and shared/root slices.
- Define shared/root coverage as `shared/**`, `scripts/**`, and root-owned
  tests/fixtures needed by those slices.
- Start measurement-only; do not add thresholds or no-drop guards yet.
- Document how to run coverage and where reports appear.
- Add focused tests/fixtures for script or config wiring where practical.

## Acceptance criteria

- Running v1 coverage produces coverage output for v1-owned code.
- Running v2 coverage produces coverage output for v2-owned code.
- Running shared/root coverage produces coverage output for shared/root-owned
  code.
- Coverage output location and interpretation are documented.
- Measurement-only enforcement is documented.
- Automated coverage wiring checks exist where practical.

## Out of scope

- Changing `jarvis1` runtime behavior.
- Wiring coverage into `bun run ready`.
- Reorganizing unrelated tests or source files.
- Adding repo-wide coverage thresholds.

## Blocker

Review and approve `v1/spec/2026-06-03T04-31-37Z-test-coverage/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis1 plan --resume-draft v1/spec/2026-06-03T04-31-37Z-test-coverage/intent.md`
