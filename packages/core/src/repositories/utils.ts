import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Ensure the directory for a storage file exists before lowdb tries to write
 * to it. lowdb/steno does not create parent directories, so the first write to
 * `./storage/*.json` fails on a fresh checkout without this. Returns the file
 * path so it can be used inline.
 */
export async function ensureStorageFile(file: string): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  return file;
}
