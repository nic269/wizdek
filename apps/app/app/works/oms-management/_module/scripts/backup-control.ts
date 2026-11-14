import { chmodSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const source = process.env.OMS_CONTROL_DB_PATH;
const [, , destination] = process.argv;
if (!(source && destination) || resolve(source) === resolve(destination)) {
  throw new Error(
    "Usage: OMS_CONTROL_DB_PATH=/data/control.sqlite tsx scripts/backup-control.ts /secure-backup/control.sqlite"
  );
}
const db = new DatabaseSync(resolve(source), { readOnly: true });
try {
  await backup(db, resolve(destination));
  chmodSync(resolve(destination), 0o600);
  console.log(
    "Consistent SQLite snapshot created. Back up the independent encryption key through your secret manager."
  );
} finally {
  db.close();
}
