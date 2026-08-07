# Plan-draft rejects mutation-checkpoint criteria that omit a resolvable enclosing test title

repo: cbrenner04/jarvis

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's enclosing `test()`/`it()` title. Authoring guidance and plan-review advisory hollow-pin do not block plan-draft today, so criteria omitting the pin title land and go hollow at implement time even when the directive and pinning resolution are correct.

- [ ] [00 - Plan-draft enclosing-test validation](./00-plan-draft-mutation-checkpoint-enclosing-test-validation.md)
