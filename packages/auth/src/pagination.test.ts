import { describe, expect, it } from "vitest";
import {
  cursorDate,
  decodeCursor,
  PaginationCursorError,
  toPage,
} from "./pagination";

describe("pagination", () => {
  it("creates an opaque cursor only when another page exists", () => {
    const page = toPage(
      [
        { id: "1", name: "Admin" },
        { id: "2", name: "Member" },
      ],
      1,
      (item) => ({ id: item.id, kind: "roles", sort: item.name })
    );

    expect(page.items).toEqual([{ id: "1", name: "Admin" }]);
    expect(decodeCursor(page.nextCursor ?? undefined, "roles")).toEqual({
      id: "1",
      kind: "roles",
      sort: "Admin",
    });
  });

  it("rejects malformed, cross-resource, and invalid date cursors", () => {
    expect(() => decodeCursor("not-a-cursor", "roles")).toThrow(
      PaginationCursorError
    );
    const cursor = Buffer.from(
      JSON.stringify({ id: "1", kind: "members", sort: "x" })
    ).toString("base64url");
    expect(() => decodeCursor(cursor, "roles")).toThrow(PaginationCursorError);
    expect(() => cursorDate("not-a-date")).toThrow(PaginationCursorError);
  });
});
