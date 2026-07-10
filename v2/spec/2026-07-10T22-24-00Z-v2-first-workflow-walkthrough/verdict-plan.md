# Verdict

Uphold the following refinements. The spec's core (command/flag surface, run-ID print, cross-link targets, auto-publish) is sound; defects concentrate in the attribution claim, omitted setup steps, and the steering narrative.

## Required refinements

1. **Correct the attribution claim (blocking, factual error).** The completion flow squashes the run's work into a *single* completion commit carrying one `Jarvis-Agent:` trailer and a `Spec: <path>` body — there is no per-commit attribution. Decision #4, the two draft-PR ACs, and the doc must describe this single-commit reality. The intent's "per-commit attribution" phrasing cannot be satisfied truthfully; reconcile the doc to what the publisher actually produces. This is exactly the paraphrase-what-you-didn't-verify defect the spec guidance warns against.

2. **Add the daemon-start step (blocking gap).** `run start` connects to the daemon and fails if it isn't running; nothing auto-starts it. A happy-path walkthrough must run `jarvis daemon start` as its first command, and an AC must cover it. The prerequisite's "daemon startable" is insufficient — the walkthrough has to actually start it.

3. **Add the real publish prerequisites.** Completion publishing gates on authenticated `gh` and shells `gh pr create --draft` against an origin remote. Authenticated `gh` and a GitHub remote are hard prerequisites; without them the happy path ends in a publish failure, not a PR. List them in Prerequisites.

4. **Explain `--artifact`.** It is a required flag backing the completion contract (the file the write step must produce). An onboarding doc must tell a first-timer what value to supply, not just list the flag.

5. **Justify the ad-hoc path and reconcile the intent's steering bullet.** The chosen `run start` (ad-hoc) path is the *only* path where live `jarvis run pause`/`kill` work (workflow-started runs reject both as `run_not_active`), but ad-hoc `resume` returns `not_implemented`. Add a decision stating ad-hoc is chosen *because* it maximizes truthful coverage of live steering commands, and reconcile the intent: the walkthrough shows pause + kill + wait as working and documents resume as not-yet-implemented, rather than promising a pause→resume happy path it cannot deliver. Do not switch to the workflow path.

6. **Qualify the resume AC as ad-hoc-only.** Workflow paused write steps *do* resume; only ad-hoc paused runs return `not_implemented`. The AC must carry the ad-hoc qualifier so the doc doesn't over-generalize resume as globally broken.

7. **Add a run-lifecycle AC.** The intent leads with "the run lifecycle a user sees." The observe section/AC only enumerate commands. Add an AC requiring the doc to describe the observable run states (running → paused → completed/failed/blocked/killed).

8. **Make the TUI AC checkable.** `jarvis tui` is a full-screen interactive TUI with no pasteable stdout. Pin the AC to describing what the reader sees (panes / live state representation) rather than an "expected output" transcript, so "shows live state via `jarvis tui`" is verifiable and not satisfiable by a hand-wave.

All command/flag claims must still be verified against `v2/src/cli.ts` before ticking, as the spec already requires.