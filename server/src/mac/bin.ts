import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

export type IsExecutable = (file: string) => Promise<boolean>;

export const isExecutable: IsExecutable = async (file) =>
  access(file, constants.X_OK).then(
    () => true,
    () => false,
  );

// The first candidate that can run. A bare name is looked up in `path` (launchd's PATH, not my shell's).
export const resolveBin = async (
  bins: string[],
  path = process.env.PATH ?? "",
  executable: IsExecutable = isExecutable,
): Promise<string | null> => {
  for (const bin of bins) {
    const candidates = bin.includes("/") ? [bin] : path.split(delimiter).map((d) => join(d, bin));
    for (const file of candidates) if (await executable(file)) return file;
  }
  return null;
};
