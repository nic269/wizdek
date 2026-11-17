import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;

export interface RunFile {
  content: string;
  path: string;
}

const makeReadableDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true });
  // The container's user is not the agent's, so do not rely on the umask.
  await chmod(path, DIRECTORY_MODE);
};

/**
 * Writes a run's files under the work directory and returns the directory
 * to mount. Paths must already be validated as relative and contained.
 */
export const writeRunFiles = async (
  workDir: string,
  runId: string,
  files: readonly RunFile[]
): Promise<{ root: string; source: string }> => {
  const root = join(workDir, "runs", runId);
  const source = join(root, "src");
  await makeReadableDirectory(root);
  await makeReadableDirectory(source);
  for (const file of files) {
    const target = join(source, file.path);
    const segments = dirname(file.path).split("/");
    let directory = source;
    for (const segment of segments) {
      if (segment !== ".") {
        directory = join(directory, segment);
        await makeReadableDirectory(directory);
      }
    }
    await writeFile(target, file.content);
    await chmod(target, FILE_MODE);
  }
  return { root, source };
};

export const removeRunFiles = (root: string): Promise<void> =>
  rm(root, { force: true, recursive: true });

/** Removes every run directory, for a clean start after a crash. */
export const clearRunFiles = (workDir: string): Promise<void> =>
  rm(join(workDir, "runs"), { force: true, recursive: true });
