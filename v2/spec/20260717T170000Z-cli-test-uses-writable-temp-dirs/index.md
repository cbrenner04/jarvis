# cli.test.ts uses writable temp dirs, not hardcoded /tmp/repo

`v2/src/cli.test.ts` hardcodes `/tmp/repo` and `/tmp/unregistered` fixture paths, which a coding
agent's sandbox denies — failing the whole `test:v2` run before any other file and blocking every v2
implement run that must run `test:v2`. Replace with per-test `mkdtempSync` roots under `$TMPDIR`.

- [ ] [00 - Replace hardcoded /tmp fixtures with mkdtemp roots](./00-mkdtemp-fixtures.md)
