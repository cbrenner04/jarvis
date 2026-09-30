# Handoff rollback restores admission after handoff-origin supersede

When a pending handoff's successor calls `supersede` and the transaction rolls back, the incumbent must reopen admission after a successful public rebind. Fallback rollback must not keep retrying a competing rebind while a live successor still owns the stable public address.

- [x] [00-rollback-clears-handoff-origin-supersede.md](00-rollback-clears-handoff-origin-supersede.md)
- [ ] [01-fallback-rollback-defers-to-live-successor.md](01-fallback-rollback-defers-to-live-successor.md)
