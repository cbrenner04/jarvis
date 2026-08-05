# Route implement to the first subspec with unticked criteria

repo: cbrenner04/jarvis

`resolveActiveLinkedSubspec` selects the first subspec whose `index.md` checkbox is
unchecked, so a hand-finished-and-merged subspec whose index box lags is re-selected,
found complete, and settles `no-work`/`completed` without ever reaching the genuinely
incomplete next subspec. The tree-level `already_complete` preflight already keys off
acceptance criteria; routing should too — and the write loop's post-write re-check, which
re-resolves the active link a second time, must stop doing that or the same tree still fails
to advance once criteria routing is in place.

- [ ] [00 - Route implement by subspec criteria](./00-route-implement-by-subspec-criteria.md)
