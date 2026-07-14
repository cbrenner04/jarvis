---
name: tests-run-under-an-isolated-jarvis-home
---

# Tests run under an isolated jarvis home

Any test that reads the machine config today resolves it through `jarvisHome()`
(`$JARVIS_HOME` or `~/.jarvis`). On the operator's machine that silently picks up a
valid `~/.jarvis/config.json`; in CI the file is absent and the code throws
`missing required 'machineProfile' key` instead of exercising the behavior under
test. The failure is CI-only, which is the worst place to find it.

Make the test harness point the jarvis home at an empty temp dir (via the bunfig
`preload` hook, so it is set before any module captures `MACHINE_CONFIG_PATH`), so a
test that reads the ambient machine config fails the same way locally as it does in
CI. Tests that legitimately need a config write their own fixture into the isolated
home or pass an explicit config path.

Scope: the harness guard and the fallout in existing tests that were relying on the
ambient config. Do not change production resolution behavior.

## Prerequisites
