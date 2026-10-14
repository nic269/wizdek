import { describe, expect, it } from "vitest";
import { parseToolVersion } from ".";
import { libpqEnvironment, pgDumpArguments } from "./env";

const target = {
  databaseName: "evisu_oms",
  host: "db.example.com",
  password: "pa ss'word",
  port: 6543,
  sslMode: "require",
  username: "backup",
};

describe("libpqEnvironment", () => {
  it("carries the whole connection in libpq variables", () => {
    expect(libpqEnvironment(target)).toMatchObject({
      PGDATABASE: "evisu_oms",
      PGHOST: "db.example.com",
      PGPASSWORD: "pa ss'word",
      PGPORT: "6543",
      PGSSLMODE: "require",
      PGUSER: "backup",
    });
  });

  it("passes nothing from this process apart from PATH", () => {
    const env = libpqEnvironment(target);
    expect(Object.keys(env).sort()).toEqual([
      "LC_ALL",
      "PATH",
      "PGAPPNAME",
      "PGCONNECT_TIMEOUT",
      "PGDATABASE",
      "PGHOST",
      "PGPASSWORD",
      "PGPORT",
      "PGSSLMODE",
      "PGUSER",
    ]);
  });

  it("omits an empty password", () => {
    expect(libpqEnvironment({ ...target, password: "" })).not.toHaveProperty(
      "PGPASSWORD"
    );
  });
});

describe("pgDumpArguments", () => {
  it("never puts connection details on the command line", () => {
    const args = pgDumpArguments("/tmp/archive-1.dump").join(" ");
    for (const value of Object.values(target)) {
      expect(args).not.toContain(String(value));
    }
    expect(args).toContain("--format=custom");
    expect(args).toContain("--no-password");
  });
});

describe("parseToolVersion", () => {
  it("reads the major version from common outputs", () => {
    expect(parseToolVersion("pg_dump (PostgreSQL) 18.6\n").major).toBe(18);
    expect(parseToolVersion("pg_dump (PostgreSQL) 16.4 (Homebrew)").major).toBe(
      16
    );
    expect(
      parseToolVersion("pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)")
        .major
    ).toBe(17);
  });

  it("rejects output it cannot read", () => {
    expect(() => parseToolVersion("command not found")).toThrow(
      "Could not read the pg_dump version"
    );
  });
});
