import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface DevOutboxInput {
  subject: string;
  text?: string;
  to: string;
}

export interface DevOutboxMessage {
  createdAt: string;
  id: string;
  subject: string;
  text?: string;
  to: string;
}

export const writeDevOutboxMessage = async (
  input: DevOutboxInput,
  root: string
) => {
  const id = crypto.randomUUID();
  const message: DevOutboxMessage = {
    createdAt: new Date().toISOString(),
    id,
    subject: input.subject,
    ...(input.text ? { text: input.text } : {}),
    to: input.to,
  };
  const directory = resolve(root);
  const path = resolve(directory, `${Date.now()}-${id}.json`);
  const temporaryPath = `${path}.tmp`;

  await mkdir(directory, { mode: 0o700, recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(message, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporaryPath, path);

  return { id, path };
};
