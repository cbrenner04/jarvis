import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferStackFromRoot } from "../src/stack-inference.ts";

describe("inferStackFromRoot", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "stack-test-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("infers TypeScript (Bun) from bun.lock + package.json", () => {
    writeFileSync(join(tmpRoot, "package.json"), "{}");
    writeFileSync(join(tmpRoot, "bun.lock"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("TypeScript (Bun)");
  });

  test("infers TypeScript (Bun) from bun.lockb + package.json", () => {
    writeFileSync(join(tmpRoot, "package.json"), "{}");
    writeFileSync(join(tmpRoot, "bun.lockb"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("TypeScript (Bun)");
  });

  test("infers JavaScript/TypeScript (Node) from package.json alone", () => {
    writeFileSync(join(tmpRoot, "package.json"), "{}");
    expect(inferStackFromRoot(tmpRoot)).toBe("JavaScript/TypeScript (Node)");
  });

  test("infers Ruby from Gemfile", () => {
    writeFileSync(join(tmpRoot, "Gemfile"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Ruby");
  });

  test("infers Go from go.mod", () => {
    writeFileSync(join(tmpRoot, "go.mod"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Go");
  });

  test("infers Python from pyproject.toml", () => {
    writeFileSync(join(tmpRoot, "pyproject.toml"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Python");
  });

  test("infers Python from requirements.txt", () => {
    writeFileSync(join(tmpRoot, "requirements.txt"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Python");
  });

  test("infers Rust from Cargo.toml", () => {
    writeFileSync(join(tmpRoot, "Cargo.toml"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Rust");
  });

  test("returns Unknown for empty root", () => {
    expect(inferStackFromRoot(tmpRoot)).toBe("Unknown");
  });

  test("polyglot: Go + Gemfile resolves to Ruby (higher priority)", () => {
    writeFileSync(join(tmpRoot, "go.mod"), "");
    writeFileSync(join(tmpRoot, "Gemfile"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Ruby");
  });

  test("polyglot: Cargo.toml + go.mod resolves to Go (higher priority)", () => {
    writeFileSync(join(tmpRoot, "Cargo.toml"), "");
    writeFileSync(join(tmpRoot, "go.mod"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("Go");
  });

  test("polyglot: package.json + Gemfile + go.mod resolves to Node (higher priority)", () => {
    writeFileSync(join(tmpRoot, "package.json"), "{}");
    writeFileSync(join(tmpRoot, "Gemfile"), "");
    writeFileSync(join(tmpRoot, "go.mod"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("JavaScript/TypeScript (Node)");
  });

  test("polyglot: bun.lock + package.json + Gemfile resolves to Bun (highest priority)", () => {
    writeFileSync(join(tmpRoot, "package.json"), "{}");
    writeFileSync(join(tmpRoot, "bun.lock"), "");
    writeFileSync(join(tmpRoot, "Gemfile"), "");
    expect(inferStackFromRoot(tmpRoot)).toBe("TypeScript (Bun)");
  });

  test("ignores subdirectories and other files", () => {
    // Create a subdirectory with marker files—should not affect inference
    const subdir = join(tmpRoot, "subdir");
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, "Gemfile"), "");
    // Root is empty
    expect(inferStackFromRoot(tmpRoot)).toBe("Unknown");
  });
});
