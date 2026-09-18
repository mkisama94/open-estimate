import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

export class SafePathError extends Error {
  public code: string;
  constructor(message: string, code: string = "FORBIDDEN_PATH") {
    super(message);
    this.name = "SafePathError";
    this.code = code;
  }
}

/**
 * Gets the workspace root directory from environment or fallback to cwd.
 */
export function getWorkspaceRoot(): string {
  const envRoot = process.env.OES_WORKSPACE_ROOT;
  const root = envRoot && envRoot.trim() !== "" ? envRoot : process.cwd();
  return path.resolve(root);
}

/**
 * Validates and resolves a safe relative path within the given workspace root.
 * Rejects path traversals, absolute paths, drive letters, UNC, NUL, and symlinks.
 */
export async function resolveSafePath(relativePath: string, rootDir?: string): Promise<string> {
  const root = path.resolve(rootDir || getWorkspaceRoot());

  if (!relativePath || relativePath.trim() === "" || relativePath === ".") {
    return root;
  }

  // Reject NUL bytes
  if (relativePath.includes("\0")) {
    throw new SafePathError("Path contains NUL byte");
  }

  // Reject drive/UNC paths
  if (/^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith("\\\\") || relativePath.startsWith("//")) {
    throw new SafePathError("Absolute drive or UNC paths are forbidden");
  }

  // Reject leading slash
  if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    throw new SafePathError("Leading slash is forbidden; path must be relative");
  }

  // Normalize path separators to POSIX for traversal check
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes(`${path.sep}..`)) {
    throw new SafePathError("Path traversal (..) is forbidden");
  }

  const resolved = path.resolve(root, normalized);

  // Ensure resolved path starts with root + separator (or is exactly root)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new SafePathError("Path escapes workspace root");
  }

  // Symlink check: check every path segment from root to resolved
  let current = root;
  const relativeParts = path.relative(root, resolved).split(path.sep);

  for (const part of relativeParts) {
    if (!part) continue;
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new SafePathError(`Symbolic links are forbidden: ${part}`);
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        // file or dir does not exist yet; ok for creating, but for reading it will fail later
        break;
      }
      throw err;
    }
  }

  return resolved;
}
