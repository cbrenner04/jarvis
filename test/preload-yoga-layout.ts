// Test preload: force yoga-layout to fully evaluate before any test file
// imports ink.
//
// yoga-layout 3.x initializes its default export via top-level await
// (const Yoga = wrapAssembly(await loadYoga())). ink's styles.js and dom.js
// access Yoga at module-eval time. On Bun/Linux, static imports don't wait
// for the TLA to resolve before evaluating dependent modules, causing
// "Cannot access 'Yoga' before initialization" (TDZ).
//
// A dynamic import with await blocks this preload's evaluation until
// yoga-layout's TLA completes. Once the preload finishes, Bun loads test
// files; their ink imports get the already-evaluated yoga-layout module.

await import("yoga-layout");

export {};
