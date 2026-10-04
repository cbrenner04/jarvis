# Restart reconciliation preserves paused runs

`beginRunReconciliation` admits `paused` and `budget-soft-stopped` rows as orphans and the daemon settles them `killed`, destroying a durable, resumable checkpoint and settling its pipeline `failed` (#3030).

- [x] [00 - Skip durably settled paused rows in orphan reconciliation](./00-skip-settled-paused-rows.md)
