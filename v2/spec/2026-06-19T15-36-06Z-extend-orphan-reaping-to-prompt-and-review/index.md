# Extend orphan reaping to prompt and review modes

repo: https://github.com/cbrenner04/jarvis

- [x] [00 - Prompt-mode orphan reaping](./00-prompt-orphan-reaping.md)
- [x] [01 - Review-pass orphan reaping](./01-review-orphan-reaping.md)

Order matters: 00 relocates the shared poll-interval constant to `reap.ts`; 01
consumes that export, so do 00 first.
