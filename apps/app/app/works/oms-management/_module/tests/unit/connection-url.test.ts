import { describe, expect, it } from "vitest";
import {
  connectionFailure,
  databaseFromUrl,
} from "../../server/profiles/url-connection";

describe("database URL connections", () => {
  it("decodes credentials without trimming passwords and ignores ORM options", () => {
    expect(
      databaseFromUrl(
        "postgresql://operator:%20p%40ss%20@db.example/oms?schema=public&sslmode=require"
      )
    ).toEqual({
      host: "db.example",
      name: "oms",
      password: { mode: "replace", value: " p@ss " },
      port: 5432,
      tls: true,
      user: "operator",
      verifyTls: false,
    });
  });
  it("supports verified TLS, explicit non-TLS and empty passwords", () => {
    expect(
      databaseFromUrl("postgres://u:p@db/oms?sslmode=verify-full")
    ).toMatchObject({ tls: true, verifyTls: true });
    expect(
      databaseFromUrl("postgres://u@localhost:5433/oms?sslmode=disable")
    ).toMatchObject({ password: { mode: "clear" }, port: 5433, tls: false });
  });
  it.each([
    "https://u:secret@db/oms",
    "postgres://u:secret@db",
    "postgres://u:%zz@db/oms",
    "postgres://u:secret@db/oms?sslmode=unknown",
  ])("rejects invalid URLs without echoing credentials", (url) => {
    expect(() => databaseFromUrl(url)).toThrow("Enter a PostgreSQL URL");
    try {
      databaseFromUrl(url);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
  it("maps database errors to actionable messages without forwarding raw errors", () => {
    expect(() =>
      connectionFailure({ code: "28P01", message: "password=secret" })
    ).toThrow("Database login failed");
    expect(() =>
      connectionFailure({ code: "UNKNOWN", message: "password=secret" })
    ).toThrow("Could not connect");
  });
});
