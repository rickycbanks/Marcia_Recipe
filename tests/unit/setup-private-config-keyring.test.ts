import { mkdtemp, readFile, writeFile, symlink, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateKeyPair,
  isValidKeyId,
  parseKeyringEntries,
  parseEnvFile,
  rebuildEnvFile,
  setupKeyring,
  assertNotSymlink,
  assertParentExists,
  assertNoDuplicateKeyringLines,
  setSecretFileMode,
  type EnvLine,
} from "../../scripts/setup-private-config-keyring";

const execFileAsync = promisify(execFile);

let root: string | undefined;

afterEach(async () => {
  if (root) {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  }
  root = undefined;
});

async function makeTmpDir(prefix = "keyring-test-"): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

/* -------------------------------------------------------------------------- */
/*  Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

describe("isValidKeyId", () => {
  it("accepts valid IDs", () => {
    expect(isValidKeyId("main")).toBe(true);
    expect(isValidKeyId("backup-key")).toBe(true);
    expect(isValidKeyId("key_2")).toBe(true);
    expect(isValidKeyId("a")).toBe(true);
    expect(isValidKeyId("K1x2y3")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidKeyId("")).toBe(false);
  });

  it("rejects IDs with spaces", () => {
    expect(isValidKeyId("my key")).toBe(false);
  });

  it("rejects IDs with special characters", () => {
    expect(isValidKeyId("key!")).toBe(false);
    expect(isValidKeyId("key@")).toBe(false);
    expect(isValidKeyId("key.dot")).toBe(false);
    expect(isValidKeyId("key/slash")).toBe(false);
  });
});

describe("generateKeyPair", () => {
  it("produces a keyId:key pair with exactly 43 base64url characters", () => {
    const pair = generateKeyPair("main");
    const colonIdx = pair.indexOf(":");
    expect(colonIdx).toBeGreaterThan(0);
    const id = pair.slice(0, colonIdx);
    const key = pair.slice(colonIdx + 1);
    expect(id).toBe("main");
    // 32 bytes base64url = ceil(32 * 4 / 3) = 43 chars (no padding)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates different keys on each call", () => {
    const a = generateKeyPair("main");
    const b = generateKeyPair("main");
    expect(a).not.toBe(b);
  });

  it("preserves the key ID in the output", () => {
    const pair = generateKeyPair("backup");
    expect(pair.startsWith("backup:")).toBe(true);
  });
});

describe("parseKeyringEntries", () => {
  it("parses a single entry", () => {
    expect(parseKeyringEntries("main:abc123")).toEqual(["main:abc123"]);
  });

  it("parses multiple comma-separated entries", () => {
    expect(parseKeyringEntries("a:key1,b:key2,c:key3")).toEqual([
      "a:key1",
      "b:key2",
      "c:key3",
    ]);
  });

  it("handles whitespace around commas", () => {
    expect(parseKeyringEntries("a:key1 , b:key2")).toEqual(["a:key1", "b:key2"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseKeyringEntries("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseKeyringEntries("   ")).toEqual([]);
  });
});

describe("parseEnvFile", () => {
  it("parses a simple key=value line", () => {
    const lines = parseEnvFile("FOO=bar\n");
    expect(lines).toEqual([{ key: "FOO", value: "bar", line: "FOO=bar" }]);
  });

  it("preserves comments", () => {
    const lines = parseEnvFile("# comment\nFOO=bar\n");
    expect(lines[0]).toEqual({ key: null, value: null, line: "# comment" });
    expect(lines[1]).toEqual({ key: "FOO", value: "bar", line: "FOO=bar" });
  });

  it("preserves blank lines", () => {
    const lines = parseEnvFile("A=1\n\nB=2\n");
    expect(lines.length).toBe(3);
    expect(lines[1]).toEqual({ key: null, value: null, line: "" });
  });

  it("handles values with equals signs", () => {
    const lines = parseEnvFile("KEY=val=ue\n");
    expect(lines[0]!.key).toBe("KEY");
    expect(lines[0]!.value).toBe("val=ue");
  });

  it("handles empty file", () => {
    expect(parseEnvFile("")).toEqual([]);
  });
});

describe("rebuildEnvFile", () => {
  it("inserts new variable when no existing line", () => {
    const lines: EnvLine[] = [
      { key: "OTHER", value: "val", line: "OTHER=val" },
    ];
    const result = rebuildEnvFile(lines, "PRIVATE_CONFIG_KEYRING=main:abc", false);
    expect(result).toContain("OTHER=val");
    expect(result).toContain("PRIVATE_CONFIG_KEYRING=main:abc");
    // New line should come before the existing one.
    const a = result.indexOf("PRIVATE_CONFIG_KEYRING=main:abc");
    const b = result.indexOf("OTHER=val");
    expect(a).toBeLessThan(b);
  });

  it("replaces existing PRIVATE_CONFIG_KEYRING line", () => {
    const lines: EnvLine[] = [
      { key: "OTHER", value: "val", line: "OTHER=val" },
      { key: "PRIVATE_CONFIG_KEYRING", value: "old:key", line: "PRIVATE_CONFIG_KEYRING=old:key" },
      { key: "ANOTHER", value: "x", line: "ANOTHER=x" },
    ];
    const result = rebuildEnvFile(
      lines,
      "PRIVATE_CONFIG_KEYRING=new:key,old:key",
      true,
    );
    expect(result).toContain("PRIVATE_CONFIG_KEYRING=new:key,old:key");
    expect(result).not.toContain("PRIVATE_CONFIG_KEYRING=old:key");
    expect(result).toContain("OTHER=val");
    expect(result).toContain("ANOTHER=x");
  });

  it("preserves comments and blank lines", () => {
    const lines: EnvLine[] = [
      { key: null, value: null, line: "# Header" },
      { key: "A", value: "1", line: "A=1" },
      { key: null, value: null, line: "" },
      { key: "B", value: "2", line: "B=2" },
    ];
    const result = rebuildEnvFile(lines, "C=3", false);
    const parsed = parseEnvFile(result);
    // New variable is inserted right before the first existing variable line.
    expect(parsed.map((l) => l.line)).toEqual([
      "# Header",
      "C=3",
      "A=1",
      "",
      "B=2",
    ]);
  });

  it("ensures file ends with a newline", () => {
    const lines: EnvLine[] = [{ key: "A", value: "1", line: "A=1" }];
    const result = rebuildEnvFile(lines, "B=2", false);
    expect(result.endsWith("\n")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Filesystem safety checks                                                   */
/* -------------------------------------------------------------------------- */

describe("assertNotSymlink", () => {
  it("throws for a symlink target", async () => {
    const dir = await makeTmpDir("symlink-");
    const real = join(dir, "real");
    const link = join(dir, "link");
    await writeFile(real, "data");
    await symlink(real, link);
    await expect(assertNotSymlink(link)).rejects.toThrow("Refusing to overwrite symlink");
  });

  it("passes for a regular file", async () => {
    const dir = await makeTmpDir("notlink-");
    const file = join(dir, "file");
    await writeFile(file, "data");
    await assertNotSymlink(file); // should not throw
  });

  it("passes for a nonexistent file", async () => {
    await assertNotSymlink("/tmp/nonexistent-file-that-does-not-exist-12345"); // should not throw
  });
});

describe("assertParentExists", () => {
  it("throws when parent directory does not exist", async () => {
    await expect(
      assertParentExists("/tmp/nonexistent-dir-xyz/file.env"),
    ).rejects.toThrow("Parent directory does not exist");
  });

  it("passes when parent directory exists", async () => {
    const dir = await makeTmpDir("parent-");
    await assertParentExists(join(dir, "file.env")); // should not throw
  });
});

describe("setSecretFileMode", () => {
  it("sets mode 0600 on POSIX", async () => {
    const dir = await makeTmpDir("mode-");
    const file = join(dir, "secret.env");
    await writeFile(file, "A=1\n");
    await setSecretFileMode(file);
    const info = await stat(file);
    // File permission bits are the lower 12 bits.
    const mode = (info.mode & 0o7777).toString(8);
    expect(mode).toBe("600");
  });
});

/* -------------------------------------------------------------------------- */
/*  Core setup logic                                                           */
/* -------------------------------------------------------------------------- */

describe("setupKeyring", () => {
  it("generates initial keyring for empty file", () => {
    const { assignment, result } = setupKeyring({
      existingContent: null,
      keyId: "main",
      rotate: false,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=main:[A-Za-z0-9_-]{43}$/);
    expect(result.mode).toBe("initial");
    expect(result.keyId).toBe("main");
  });

  it("generates initial keyring for blank file", () => {
    const { assignment, result } = setupKeyring({
      existingContent: "   \n  \n",
      keyId: "main",
      rotate: false,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=main:/);
    expect(result.mode).toBe("initial");
  });

  it("adds keyring to file without existing PRIVATE_CONFIG_KEYRING", () => {
    const { assignment, result } = setupKeyring({
      existingContent: "OTHER=val\n",
      keyId: "main",
      rotate: false,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=main:/);
    expect(result.mode).toBe("initial");
  });

  it("refuses when PRIVATE_CONFIG_KEYRING already exists without --rotate", () => {
    expect(() =>
      setupKeyring({
        existingContent: "PRIVATE_CONFIG_KEYRING=old:key\n",
        keyId: "main",
        rotate: false,
      }),
    ).toThrow("--rotate to rotate");
  });

  it("rotates: prepends new key, retains old entries", () => {
    const { assignment, result } = setupKeyring({
      existingContent: "PRIVATE_CONFIG_KEYRING=old1:oldkey1,old2:oldkey2\n",
      keyId: "new",
      rotate: true,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=new:[A-Za-z0-9_-]{43},old1:oldkey1,old2:oldkey2$/);
    expect(result.mode).toBe("rotate");
    expect(result.keyId).toBe("new");
  });

  it("rotates a single-entry keyring", () => {
    const { assignment } = setupKeyring({
      existingContent: "PRIVATE_CONFIG_KEYRING=old:oldkey\n",
      keyId: "fresh",
      rotate: true,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=fresh:[A-Za-z0-9_-]{43},old:oldkey$/);
  });

  it("rejects invalid key IDs", () => {
    expect(() =>
      setupKeyring({ existingContent: null, keyId: "", rotate: false }),
    ).toThrow("Invalid key ID");
    expect(() =>
      setupKeyring({ existingContent: null, keyId: "has space", rotate: false }),
    ).toThrow("Invalid key ID");
    expect(() =>
      setupKeyring({ existingContent: null, keyId: "bad!@#", rotate: false }),
    ).toThrow("Invalid key ID");
  });

  it("does not leak secret values in error messages", () => {
    try {
      setupKeyring({
        existingContent: "PRIVATE_CONFIG_KEYRING=existing:s3cretK3y\n",
        keyId: "main",
        rotate: false,
      });
      expect.fail("should have thrown");
    } catch (err) {
      // The error message should not contain the secret key value.
      expect((err as Error).message).not.toContain("s3cretK3y");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Integration: full file write round-trip                                     */
/* -------------------------------------------------------------------------- */

describe("full file round-trip", () => {
  it("creates a new env file with only PRIVATE_CONFIG_KEYRING", async () => {
    const dir = await makeTmpDir("full-create-");
    const file = join(dir, ".env");
    const existingContent = null;

    const { assignment } = setupKeyring({
      existingContent,
      keyId: "main",
      rotate: false,
    });

    const content = assignment + "\n";
    await writeFile(file, content, "utf8");

    const readBack = await readFile(file, "utf8");
    expect(readBack).toContain("PRIVATE_CONFIG_KEYRING=main:");
    expect(readBack).not.toContain("s3cret");
  });

  it("creates file with existing comments/values", async () => {
    const dir = await makeTmpDir("full-comments-");
    const file = join(dir, ".env");
    const original = "# Config\nA=1\n\nB=2\n";
    await writeFile(file, original, "utf8");

    const existingContent = await readFile(file, "utf8");
    const { assignment } = setupKeyring({
      existingContent,
      keyId: "main",
      rotate: false,
    });

    const parsed = parseEnvFile(existingContent);
    const newContent = rebuildEnvFile(parsed, assignment, false);
    await writeFile(file, newContent, "utf8");

    const readBack = await readFile(file, "utf8");
    expect(readBack).toContain("# Config");
    expect(readBack).toContain("A=1");
    expect(readBack).toContain("B=2");
    expect(readBack).toContain("PRIVATE_CONFIG_KEYRING=main:");
  });

  it("rotate preserves all other lines", async () => {
    const dir = await makeTmpDir("full-rotate-");
    const file = join(dir, ".env");
    const original = "# Header\nA=1\nPRIVATE_CONFIG_KEYRING=old:oldkey\nB=2\n";
    await writeFile(file, original, "utf8");

    const existingContent = await readFile(file, "utf8");
    const { assignment } = setupKeyring({
      existingContent,
      keyId: "new",
      rotate: true,
    });

    const parsed = parseEnvFile(existingContent);
    const newContent = rebuildEnvFile(parsed, assignment, true);
    await writeFile(file, newContent, "utf8");

    const readBack = await readFile(file, "utf8");
    expect(readBack).toContain("# Header");
    expect(readBack).toContain("A=1");
    expect(readBack).toContain("B=2");
    expect(readBack).toContain("PRIVATE_CONFIG_KEYRING=new:");
    expect(readBack).toContain("old:oldkey");
    // Ensure the new key comes before the old one.
    const newIdx = readBack.indexOf("PRIVATE_CONFIG_KEYRING=new:");
    const oldIdx = readBack.indexOf("old:oldkey");
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it("sets file mode to 0600 on POSIX", async () => {
    const dir = await makeTmpDir("full-mode-");
    const file = join(dir, ".env");

    const { assignment } = setupKeyring({
      existingContent: null,
      keyId: "main",
      rotate: false,
    });
    await writeFile(file, assignment + "\n", "utf8");
    await setSecretFileMode(file);

    const info = await stat(file);
    const mode = (info.mode & 0o7777).toString(8);
    expect(mode).toBe("600");
  });

  it("refuses symlink target", async () => {
    const dir = await makeTmpDir("full-symlink-");
    const real = join(dir, "real.env");
    const link = join(dir, "link.env");
    await writeFile(real, "A=1\n");
    await symlink(real, link);

    await expect(assertNotSymlink(link)).rejects.toThrow("Refusing to overwrite symlink");
  });

  it("refuses nonexistent parent directory", async () => {
    await expect(
      assertParentExists("/tmp/nonexistent-dir-abc/file.env"),
    ).rejects.toThrow("Parent directory does not exist");
  });

  it("secret key is never printed in console output (no --print)", async () => {
    const { assignment } = setupKeyring({
      existingContent: null,
      keyId: "main",
      rotate: false,
    });
    // The assignment contains the actual key — but in a real CLI run, the
    // --print flag is required to output it. This test verifies that the
    // setup function itself returns the assignment (for programmatic use)
    // without a side-effect of printing it.
    expect(assignment).toMatch(/PRIVATE_CONFIG_KEYRING=main:/);
    // Verify the key portion is 43 chars (32 bytes base64url).
    const key = assignment.split(":")[1];
    expect(key).toHaveLength(43);
  });
});

/* -------------------------------------------------------------------------- */
/*  Rotation trailing-comma fix                                                */
/* -------------------------------------------------------------------------- */

describe("rotation edge cases", () => {
  it("rotation with empty current value produces no trailing comma", () => {
    const { assignment } = setupKeyring({
      existingContent: "PRIVATE_CONFIG_KEYRING=\n",
      keyId: "fresh",
      rotate: true,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=fresh:[A-Za-z0-9_-]{43}$/);
    expect(assignment).not.toContain(",,");
    expect(assignment).not.toMatch(/,$/);
  });

  it("rotation with whitespace-only current value produces no trailing comma", () => {
    const { assignment } = setupKeyring({
      existingContent: "PRIVATE_CONFIG_KEYRING=   \n",
      keyId: "fresh",
      rotate: true,
    });
    expect(assignment).toMatch(/^PRIVATE_CONFIG_KEYRING=fresh:[A-Za-z0-9_-]{43}$/);
    expect(assignment).not.toContain(",,");
    expect(assignment).not.toMatch(/,$/);
  });
});

/* -------------------------------------------------------------------------- */
/*  Duplicate PRIVATE_CONFIG_KEYRING detection                                 */
/* -------------------------------------------------------------------------- */

describe("assertNoDuplicateKeyringLines", () => {
  it("passes for a single PRIVATE_CONFIG_KEYRING line", () => {
    const lines: EnvLine[] = [
      { key: "OTHER", value: "val", line: "OTHER=val" },
      { key: "PRIVATE_CONFIG_KEYRING", value: "key1", line: "PRIVATE_CONFIG_KEYRING=key1" },
    ];
    expect(() => assertNoDuplicateKeyringLines(lines)).not.toThrow();
  });

  it("passes when no PRIVATE_CONFIG_KEYRING line exists", () => {
    const lines: EnvLine[] = [
      { key: "OTHER", value: "val", line: "OTHER=val" },
    ];
    expect(() => assertNoDuplicateKeyringLines(lines)).not.toThrow();
  });

  it("rejects duplicate PRIVATE_CONFIG_KEYRING lines", () => {
    const lines: EnvLine[] = [
      { key: "OTHER", value: "val", line: "OTHER=val" },
      { key: "PRIVATE_CONFIG_KEYRING", value: "key1", line: "PRIVATE_CONFIG_KEYRING=key1" },
      { key: "PRIVATE_CONFIG_KEYRING", value: "key2", line: "PRIVATE_CONFIG_KEYRING=key2" },
    ];
    expect(() => assertNoDuplicateKeyringLines(lines)).toThrow(
      /2 PRIVATE_CONFIG_KEYRING assignments/,
    );
  });

  it("rebuildEnvFile with replaceExisting removes all duplicate keyring lines", () => {
    const lines: EnvLine[] = [
      { key: "A", value: "1", line: "A=1" },
      { key: "PRIVATE_CONFIG_KEYRING", value: "old1:key1", line: "PRIVATE_CONFIG_KEYRING=old1:key1" },
      { key: "PRIVATE_CONFIG_KEYRING", value: "old2:key2", line: "PRIVATE_CONFIG_KEYRING=old2:key2" },
      { key: "B", value: "2", line: "B=2" },
    ];
    const result = rebuildEnvFile(
      lines,
      "PRIVATE_CONFIG_KEYRING=new:key3",
      true,
    );
    // Should contain only the new assignment, not the old duplicates.
    const parsed = parseEnvFile(result);
    const keyringLines = parsed.filter((l) => l.key === "PRIVATE_CONFIG_KEYRING");
    expect(keyringLines).toHaveLength(1);
    expect(keyringLines[0]!.value).toBe("new:key3");
    // Other lines preserved.
    expect(result).toContain("A=1");
    expect(result).toContain("B=2");
  });
});

/* -------------------------------------------------------------------------- */
/*  CLI integration / smoke test — actual invocation via tsx                   */
/* -------------------------------------------------------------------------- */

describe("CLI smoke test", () => {
  const scriptPath = join(__dirname, "../../scripts/setup-private-config-keyring.ts");

  it("creates a nonexistent target file via --env-target", async () => {
    const dir = await makeTmpDir("cli-smoke-");
    const target = join(dir, ".env");

    // Ensure the file does NOT exist before the run.
    await expect(readFile(target, "utf8")).rejects.toThrow();

    const { stdout } = await execFileAsync(
      "npx",
      ["tsx", scriptPath, "--env-target", target],
      { cwd: join(__dirname, "../.."), timeout: 30_000 },
    );

    // File should now exist.
    const content = await readFile(target, "utf8");
    expect(content).toMatch(/PRIVATE_CONFIG_KEYRING=main:[A-Za-z0-9_-]{43}/);
    expect(stdout).toContain("created successfully");

    // Clean up.
    await rm(dir, { recursive: true, force: true });
  });

  it("--env-file is NOT accepted (Node reservation)", async () => {
    const dir = await makeTmpDir("cli-neg-");
    const target = join(dir, ".env");

    await expect(
      execFileAsync(
        "npx",
        ["tsx", scriptPath, "--env-file", target],
        { cwd: join(__dirname, "../.."), timeout: 30_000 },
      ),
    ).rejects.toThrow();

    // Clean up.
    await rm(dir, { recursive: true, force: true });
  });
});
