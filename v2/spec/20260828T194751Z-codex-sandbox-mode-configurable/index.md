# Codex sandbox mode is configurable

repo: cbrenner04/jarvis

Seeds #3028. Two chained behaviors on one branch: the shared Codex binding honors a resolved sandbox mode, then v2 threads the mode from machine config. Subspec 01 depends on 00 (built on the same branch, in order).

- [ ] [00 - Codex bindings honor a resolved sandbox mode](./00-codex-binding-honors-sandbox-mode.md)
- [ ] [01 - V2 write/implement Codex invocations use the configured sandbox mode](./01-v2-codex-sandbox-mode-from-machine-config.md)
