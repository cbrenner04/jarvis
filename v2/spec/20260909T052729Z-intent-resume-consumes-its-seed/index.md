# Intent resume consumes its seed

`resolveIntentFinalizationResumeContext` rebuilds the intent-stage `PublicationLanding` from the persisted snapshot without `inputs`, so `resumePopulatedIntentPublication` lands the ready-intents and opens the PR while the seed the first pass would have consumed survives its own split.

- [ ] [00 - Persist landing inputs on the snapshot and consume them on resume](./00-persist-landing-inputs-and-consume-on-resume.md)
