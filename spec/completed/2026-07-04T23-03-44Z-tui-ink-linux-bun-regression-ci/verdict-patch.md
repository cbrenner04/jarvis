## Verdict: No required changes

Both raised concerns are resolved without action:

- The `SANDBOX_SUFFIX` classifier's `.tsx` blind spot is real but latent — no `.sandbox-unrunnable.test.tsx` file exists today, it's out of scope per the subspec's decisions (which scope the fix to `walkV2TestFiles`'s glob specifically), and it doesn't misclassify anything currently. Worth a follow-up seed, not a blocker on this subspec.
- The AC's verification command (`grep -c "smoke: loadInkUi"`) is accurate — it matches the literal test name in `tui-field-collector.test.tsx:51`.

Doc citation and Linux/Bun CI wiring both check out against the actual files. No outstanding issues.