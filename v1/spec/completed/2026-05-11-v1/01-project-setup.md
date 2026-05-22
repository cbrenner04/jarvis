# 01 — Project setup

Bootstrap the Bun + strict TypeScript project.

## Tasks

- [x] `bun init` (or equivalent) producing `package.json`, `tsconfig.json`, `bun.lockb`.
- [x] `tsconfig.json` enables: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`. Target `ESNext`, module `ESNext`, `moduleResolution: bundler`.
- [x] `package.json` scripts: `typecheck` (`tsc --noEmit`), `test` (`bun test`), `start` (`bun run src/index.ts`).
- [x] `src/index.ts` placeholder exporting nothing, importable.
- [x] `.gitignore` covers `node_modules/`, `*.log`, `.DS_Store`, `dist/`.
- [x] One trivial `bun test` exists and passes (e.g. `expect(1).toBe(1)`), so CI/local commands have something to run.

## Acceptance criteria

- `bun install` succeeds.
- `bun run typecheck` exits 0.
- `bun test` exits 0.

## Documentation updates

- Add a "Development" section to `README.md` listing the three scripts.
