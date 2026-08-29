import { describe, expect, test } from "bun:test";
import { isCheckpointTestFileReference } from "./mutation-checkpoint-criteria.ts";

describe("checkpoint pin-file recognition", () => {
  test("recognizes language-neutral checkpoint pin files", () => {
    // @mutate shared/mutation-checkpoint-criteria.ts "return LANGUAGE_NEUTRAL_CHECKPOINT_TEST_FILE_PATTERN.test(name);" -> "return false;"
    const recognized = [
      "ChessPracticeTests/RootContentTest.swift",
      "ChessPracticeTests/RootContentTests.swift",
      "RootContentTest.m",
      "RootContentTests.m",
      "RootContentTest.kt",
      "RootContentTests.kt",
      "RootContentTest.java",
      "RootContentTests.java",
      "foo_test.go",
      "foo_test.py",
      "test_foo.py",
      "foo_test.rb",
      "foo_spec.rb",
      "foo_test.exs",
      "foo.test.ts",
      "foo.test.mts",
      "foo.test.custom",
      "FOO.TEST.TSX",
      "Test.swift",
      "_test.go",
      "test_.py",
    ];

    for (const reference of recognized) {
      expect(isCheckpointTestFileReference(reference)).toBe(true);
    }

    for (const reference of [
      "src/main.swift",
      "latest.swift",
      "contest.go",
      "mytest.py",
      "spec_helper.rb",
      "RootContentTest.swift.bak",
      "RootContenttest.swift",
      "foo_Test.go",
      "Test_Foo.py",
      "tests.test.ts/latest.swift",
    ]) {
      expect(isCheckpointTestFileReference(reference)).toBe(false);
    }
  });
});
