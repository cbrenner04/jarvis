# Pipeline resume lists resumable fan-out lanes when branch key is omitted

- [ ] [00 - Unscoped resume lists fan-out failed plan lanes](./00-unscoped-resume-lists-fanout-failed-plan-lanes.md)

Scope: when unscoped `pipeline resume` would claim aggregate `awaiting-approval` on a fan-out pipeline but one or more branches carry a resumable failed `plan` lane, refuse with those `branchKey` values on stderr instead of silently claiming or opaque refusal; unscoped paths without such lanes unchanged.
