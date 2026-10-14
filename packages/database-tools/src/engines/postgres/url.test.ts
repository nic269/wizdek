import { describe, expect, it } from "vitest";
import { DatabaseToolsError } from "../../errors";
import { parsePostgresUrl } from "./url";

const failureOf = (url: string) => {
  try {
    parsePostgresUrl(url);
  } catch (error) {
    if (error instanceof DatabaseToolsError) {
      return { failure: error.failure, message: error.message };
    }
    throw error;
  }
  throw new Error("Expected the URL to be rejected.");
};

describe("parsePostgresUrl", () => {
  it("reads every part of a full URL", () => {
    expect(
      parsePostgresUrl(
        "postgresql://postgres:postgres@localhost:5432/evisu_oms"
      )
    ).toEqual({
      databaseName: "evisu_oms",
      host: "localhost",
      password: "postgres",
      port: 5432,
      username: "postgres",
    });
  });

  it("accepts the postgres scheme and defaults the port", () => {
    expect(
      parsePostgresUrl("postgres://app:pw@db.internal/orders")
    ).toMatchObject({ host: "db.internal", port: 5432 });
  });

  it("decodes percent-encoded credentials", () => {
    expect(
      parsePostgresUrl("postgresql://us%40er:p%40ss%2Fw%3Ard@h:6543/d")
    ).toMatchObject({ password: "p@ss/w:rd", port: 6543, username: "us@er" });
  });

  it("allows a URL without a password", () => {
    expect(parsePostgresUrl("postgresql://reader@h/d").password).toBe("");
  });

  it("keeps sslmode and drops parameters written for an ORM", () => {
    expect(
      parsePostgresUrl(
        "postgresql://u:p@h/d?schema=public&connection_limit=5&sslmode=require&pgbouncer=true"
      )
    ).toEqual({
      databaseName: "d",
      host: "h",
      password: "p",
      port: 5432,
      sslMode: "require",
      username: "u",
    });
  });

  it("strips the brackets from an IPv6 host", () => {
    expect(parsePostgresUrl("postgresql://u:p@[::1]:5432/d").host).toBe("::1");
  });

  it("rejects incomplete or malformed URLs without echoing them", () => {
    for (const url of [
      "not a url",
      "postgresql://u:secret@h",
      "postgresql://:secret@h/d",
      "postgresql://u:secret@h/d?sslmode=sometimes",
      "mysql://u:secret@h/d",
    ]) {
      const { failure, message } = failureOf(url);
      expect(failure).toBe("INVALID_URL");
      expect(message).not.toContain("secret");
    }
  });
});
