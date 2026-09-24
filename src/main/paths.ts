import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expands a leading "~" to the real home directory. Path fields in the
 * renderer (the iMessage dbPath default, most notably) are plain text
 * inputs with no shell between them and the filesystem, so "~" never
 * gets shell-expanded the way it would at a terminal prompt — Node/
 * Electron don't do that on their own. Anything else passes through
 * unchanged.
 */
export function expandHome(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) return join(homedir(), inputPath.slice(2));
  return inputPath;
}
