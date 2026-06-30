// Test preload: force yoga-layout to finish its top-level await before ink
// loads, so ink's styles.js can access the Yoga binding at module-eval time.
//
// yoga-layout 3.x initializes its default export via top-level await
// (const Yoga = wrapAssembly(await loadYoga())). ink's styles.js accesses
// Yoga.EDGE_TOP at module-eval time. Without this preload, Bun on Linux hits
// "Cannot access 'Yoga' before initialization" (TDZ) because yoga-layout has
// not finished evaluating when styles.js runs. Importing yoga-layout here
// ensures it is fully evaluated before any test file imports ink.

import "yoga-layout";
