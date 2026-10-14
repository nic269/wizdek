# Database tools

The **Database** page holds tools that work directly on a database. Today there is one: backing up a PostgreSQL database to a file you can download and restore. A typical use is taking a backup of a production database before deploying a release that migrates it.

Everything starts from a **connection**: a database URL saved, encrypted, for the organization.

## Who can use it

| Permission | Allows |
|------------|--------|
| `databases:read` | Seeing connections and their backup history |
| `databases:manage` | Adding, editing and deleting connections |
| `databases:backup` | Starting backups, downloading and deleting backup files |

Owners and Admins have all three. Members and Viewers have none, because a connection reaches production data and a backup file contains all of it. Give someone access with a custom role under **Settings → Access**.

## Supported databases

| Engine | URL scheme | Backup tool | File |
|--------|------------|-------------|------|
| PostgreSQL | `postgresql://` or `postgres://` | `pg_dump` | `.dump` (custom format, compressed) |

MySQL, MariaDB and MongoDB are not supported yet. See [Not supported yet](#not-supported-yet).

## Adding a connection

1. Open **Database → Add connection**.
2. Give it a name, for example `EVISU production`.
3. Paste the URL: `postgresql://user:password@host:5432/database`. Characters such as `@`, `/` or `:` in the user name or password must be percent-encoded (`@` is `%40`).
4. Choose **Save connection**.

The toolkit connects once to check the URL and reads the server version. A URL that cannot connect is not saved, and the error never includes the password. Once saved, the URL is stored encrypted and is never shown again. To change the password later, choose **Edit** on the connection and paste a new URL; leave the field blank to keep the saved one.

Only `sslmode` is read from the URL's query string. Other parameters, such as `schema` or `connection_limit` from a URL written for an ORM, are ignored, so a `DATABASE_URL` copied from an application's environment usually works as is.

**`localhost` means the machine the toolkit's API runs on.** A URL like `postgresql://postgres:postgres@localhost:5432/evisu_oms` works when you run the toolkit on your own computer and the database, or a tunnel to it, is there too. A deployed toolkit cannot reach your computer; use a host the deployed API can reach.

## Backing up

Open the connection and choose **Back up now**. The backup runs in the background; you can leave the page.

| Status | Meaning |
|--------|---------|
| Queued | Waiting for a worker. Only one backup of a connection runs at a time. |
| Running | `pg_dump` is reading the database, or the file is being checked and stored. |
| Completed | The file is stored and can be downloaded. |
| Failed | Nothing was stored. The reason is shown under the status. |

A backup:

1. checks that the installed `pg_dump` is at least as new as the server, and fails with both versions named if it is not;
2. dumps the whole database into a temporary file;
3. runs `pg_restore --list` on the file, so a file that could not be restored is never reported as a success;
4. uploads the file to the toolkit's storage, records its size and SHA-256, and deletes the temporary file.

`pg_dump` reads a consistent snapshot and does not block reads or writes on the source. It does block schema changes, such as a migration, until it finishes, so take the backup before the deploy starts migrating.

Backups are kept until you delete them, including after their connection is deleted; those appear on the Database page under **Backups of deleted connections**.

## Restoring

The toolkit does not restore from the UI. Restore by hand with `pg_restore` from the same or a newer PostgreSQL client.

List what the file contains:

```bash
pg_restore --list EVISU-production-2026-10-14T03-21-38-000Z.dump
```

Restore into an existing, empty database:

```bash
pg_restore --no-owner --dbname="postgresql://user:password@host:5432/evisu_oms_restore" \
  EVISU-production-2026-10-14T03-21-38-000Z.dump
```

**Restoring into PostgreSQL 16 or older** with the version 18 client prints one error and exits with status 1:

```text
pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
pg_restore: warning: errors ignored on restore: 1
```

`pg_restore` 18 sends this setting when it connects, and the server does not know it. The restore continues and the data is complete. Any other error, or more than one, is a real problem.

To restore over a database that already has the objects, add `--clean --if-exists`. That drops and recreates every object in the file, and the data in them is lost. Rehearse the restore against a non-production database first. `--no-owner` makes the connecting user own the restored objects, which avoids errors when the original roles do not exist on the target server.

## Setting up the client tools

Backups run `pg_dump` and `pg_restore` on the machine that runs the toolkit's API. The client must be at least the major version of every server you back up; a newer client can back up older servers.

- **Deployed API image.** The `api-runner` stage of the `Dockerfile` installs PostgreSQL client 18, and `pnpm docker:validate` checks both tools are present.
- **macOS.** Install the client with Homebrew. It is not added to `PATH`, so point the toolkit at it in `.env`:

  ```bash
  brew install libpq
  ```

  ```dotenv
  POSTGRES_CLIENT_BIN_DIR=/opt/homebrew/opt/libpq/bin
  ```

- **Debian or Ubuntu.** Install `postgresql-client-18` from the PostgreSQL apt repository and set `POSTGRES_CLIENT_BIN_DIR=/usr/lib/postgresql/18/bin`, or put that directory on `PATH`.

The backup integration tests need the same tools and fail with these instructions when they are missing.

## Operating notes

- **Temporary space.** A dump is written to a temporary file before it is checked and uploaded, so the API needs free disk space equal to the largest backup. Set `DATABASE_BACKUP_TMP_DIR` to use a larger volume; it defaults to the operating system's temporary directory.
- **Where files are stored.** Backups go to the storage provider set by `STORAGE_PROVIDER`. With `local`, files live under `LOCAL_STORAGE_DIR` on the API's disk; in a container that directory must be a persistent volume or backups are lost on redeploy. S3 or R2 is the better choice for a deployed toolkit. Downloads from S3 or R2 go through a link that is valid for 60 seconds.
- **Encryption.** Connection URLs are encrypted with `SHOPIFY_TOKEN_ENCRYPTION_KEY`, the same key as Shopify credentials. Back it up with the toolkit's own database. Backup files are not encrypted by the toolkit: S3 objects use server-side encryption, and local files rely on disk permissions. Treat a downloaded file like the production database it came from.
- **Long backups.** A backup is stopped after 12 hours. If the API shuts down or restarts during a backup, the backup is marked failed and can be started again; a backup lost to a crash is retried once.
- **Audit log.** Adding, editing and deleting a connection, and starting, downloading and deleting a backup, are recorded in the organization's audit log. URLs and passwords are never included.
- **Network reach.** A deployed API connects to whatever host a permitted user enters, including hosts on its own private network. This is why only Owners and Admins can add connections by default. See [decision 0005](./decisions/0005-database-backups-with-native-dump-tools.md).

## Not supported yet

These engines are deferred until there is a real need for them. Adding one means writing one adapter in `packages/database-tools/src/engines/`; nothing else depends on the engine.

| Engine | What is known |
|--------|---------------|
| MySQL / MariaDB | The tool would be `mysqldump --single-transaction`, producing gzip-compressed SQL. Alpine ships the MariaDB client, which differs from the MySQL 8 client in places; test against the actual server first. |
| MongoDB | The tool would be `mongodump --archive --gzip`. Whether `mongodb-tools` is available for the Alpine release behind `node:24-alpine` has not been checked; the API image might need a Debian base. |
