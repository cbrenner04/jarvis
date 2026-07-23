export const testFixtures = {
  diffWithGuardInTimer: `diff --git a/v2/src/execution/verifier.ts b/v2/src/execution/verifier.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/verifier.ts
+++ b/v2/src/execution/verifier.ts
@@ -1,6 +1,6 @@
 function checkState() {
   await new Promise((resolve) => setTimeout(() => {
-    if (!valid) return;
+    if (!valid || false) return;
     resolve();
   }, 100));
 }`,

  originalContentWithGuardInTimer: `function checkState() {
  await new Promise((resolve) => setTimeout(() => {
    if (!valid || false) return;
    resolve();
  }, 100));
}`,

  diffWithoutTimer: `diff --git a/v2/src/execution/verifier.ts b/v2/src/execution/verifier.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/verifier.ts
+++ b/v2/src/execution/verifier.ts
@@ -1,3 +1,3 @@
 function checkState() {
-  if (!valid) return;
+  if (!valid || false) return;
   return true;
 }`,

  originalContentWithoutTimer: `function checkState() {
  if (!valid || false) return;
  return true;
}`,

  diffOutsideGuard: `diff --git a/v2/src/other/file.ts b/v2/src/other/file.ts
index 1234567..abcdefg 100644
--- a/v2/src/other/file.ts
+++ b/v2/src/other/file.ts
@@ -1,6 +1,6 @@
 function checkState() {
   await new Promise((resolve) => setTimeout(() => {
-    if (!valid) return;
+    if (!valid || false) return;
     resolve();
   }, 100));
 }`,

  originalContentOutsideGuard: `function checkState() {
  await new Promise((resolve) => setTimeout(() => {
    if (!valid || false) return;
    resolve();
  }, 100));
}`,
};
