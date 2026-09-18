import { describe, it, expect } from "vitest";
import { resolveSafePath, SafePathError, getWorkspaceRoot } from "../../src/collector/safe-paths.js";
import path from "node:path";

describe("Safe Paths (T02 / A83)", () => {
  const root = getWorkspaceRoot();

  it("resolves root when relative path is empty or dot", async () => {
    expect(await resolveSafePath("", root)).toBe(root);
    expect(await resolveSafePath(".", root)).toBe(root);
  });

  it("resolves valid relative subpaths", async () => {
    const resolved = await resolveSafePath("docs/milestones", root);
    expect(resolved).toBe(path.resolve(root, "docs/milestones"));
  });

  it("rejects path traversal attempting to escape root", async () => {
    await expect(resolveSafePath("../outside", root)).rejects.toThrow(SafePathError);
    await expect(resolveSafePath("docs/../../outside", root)).rejects.toThrow(SafePathError);
  });

  it("rejects leading slash / absolute paths", async () => {
    await expect(resolveSafePath("/etc/passwd", root)).rejects.toThrow(SafePathError);
    await expect(resolveSafePath("\\windows\\system32", root)).rejects.toThrow(SafePathError);
  });

  it("rejects Windows drive letters or UNC", async () => {
    await expect(resolveSafePath("C:\\Windows", root)).rejects.toThrow(SafePathError);
    await expect(resolveSafePath("\\\\server\\share", root)).rejects.toThrow(SafePathError);
  });

  it("rejects NUL bytes", async () => {
    await expect(resolveSafePath("test\0file", root)).rejects.toThrow(SafePathError);
  });
});
