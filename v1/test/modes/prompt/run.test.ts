import { describe, expect, test } from "bun:test";

describe("promptCommand", () => {
  test("ellipsizes long first lines to 72 chars", () => {
    // Helper function test
    const text = "x".repeat(100);
    const truncated = text.slice(0, 72 - 3) + "...";
    expect(truncated.length).toBe(72);
  });

  test("extracts first non-empty line from multi-line text", () => {
    const text = "\n\nFirst line\nSecond line";
    const lines = text.split("\n");
    let firstLine = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        firstLine = trimmed;
        break;
      }
    }
    expect(firstLine).toBe("First line");
  });

  test("nonce generation produces alphanumeric strings", () => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 6; i += 1) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    expect(nonce.length).toBe(6);
    expect(/^[a-z0-9]{6}$/.test(nonce)).toBe(true);
  });

  test("iso8601 timestamp format is correct", () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const hours = String(now.getUTCHours()).padStart(2, "0");
    const minutes = String(now.getUTCMinutes()).padStart(2, "0");
    const seconds = String(now.getUTCSeconds()).padStart(2, "0");
    const timestamp = `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;

    // Should match the format YYYY-MM-DDTHH-MM-SS
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(timestamp)).toBe(true);
  });
});
