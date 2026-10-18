import fs from "node:fs/promises";
import path from "node:path";

/** User-local data only; never write through an existing symlink/junction. */
export async function privateDirectory(dir: string): Promise<void> {
  const full = path.resolve(dir);
  let cursor = path.parse(full).root;
  for (const part of path.relative(cursor, full).split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    try { await fs.mkdir(cursor, { mode: 0o700 }); }
    catch (e: any) { if (e.code !== "EEXIST") throw e; }
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("UNSAFE_STATE_DIRECTORY");
  }
}
