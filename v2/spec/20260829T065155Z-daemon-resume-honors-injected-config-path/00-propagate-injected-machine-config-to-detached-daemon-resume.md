# Propagate injected machine config to detached daemon resume

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Detached daemon startup currently gives the child process its socket path but does not demonstrably carry the invoking CLI's selected machine-config path into daemon runtime. Resume reconstruction therefore has no production-scoped config source. This prerequisite must land before the resume fallback slice.

## Decision ledger

- Carry the selected machine-config path from detached daemon launch into its runtime and make it the source used by resumed write-loop binding resolution; rules out substituting `jarvisHome()` in the detached process.
- Prove the full operator path with a real detached daemon and resume RPC, not `setWriteLoopBindingSourceDepsForTests` or another test-only dependency injection seam.
- Keep the configured path process-scoped to the daemon that received it; a daemon not launched with an injected path retains existing loader-default behavior.

## Tasks

- [ ] Propagate the invoking CLI's selected machine-config path through detached daemon launch and entrypoint startup into daemon runtime.
- [ ] Scope resumed write-loop binding resolution to that runtime path without changing the existing no-injection default.
- [ ] Add detached-daemon resume coverage with distinct operator-home and injected configs and no test-only binding-source injection.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-detached-resume.sandbox-unrunnable.test.ts` — `operator-triggered detached daemon resume uses the injected config`; a real detached daemon launched with an injected config resumes a legacy snapshot missing `iterationCeilingMs` through IPC and dispatches the injected ceiling rather than a distinct `JARVIS_HOME/config.json` ceiling, without `setWriteLoopBindingSourceDepsForTests`. Keystone checkpoint: the test carries an in-body `// @mutate v2/src/daemon/daemon-lifecycle.ts "DAEMON_MACHINE_CONFIG_PATH: options?.machineConfigPath," -> "DAEMON_MACHINE_CONFIG_PATH: undefined,"` directive that removes detached daemon path propagation and turns the scoped test RED.
- [ ] `v2/src/daemon/daemon-detached-resume.sandbox-unrunnable.test.ts` test `detached daemon without an injected config uses the loader default` stays green.
- [ ] The detached-resume coverage runs green after the propagation mutation is restored.

## Documentation updates

- None in this prerequisite slice; the following resume slice documents the shipped scoped behavior after its fallback regression lands.
