import { z } from "zod";

const cursorSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  sort: z.string(),
});

export interface PageInput {
  cursor?: string;
  limit: number;
  organizationId: string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export class PaginationCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "PaginationCursorError";
  }
}

export const decodeCursor = (value: string | undefined, kind: string) => {
  if (!value) {
    return;
  }
  try {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    );
    if (cursor.kind !== kind) {
      throw new PaginationCursorError();
    }
    return cursor;
  } catch (error) {
    if (error instanceof PaginationCursorError) {
      throw error;
    }
    throw new PaginationCursorError();
  }
};

export const cursorDate = (sort: string) => {
  const date = new Date(sort);
  if (Number.isNaN(date.getTime())) {
    throw new PaginationCursorError();
  }
  return date;
};

export const toPage = <T>(
  rows: T[],
  limit: number,
  cursorFor: (row: T) => { id: string; kind: string; sort: string }
): PageResult<T> => {
  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasNextPage && last
        ? Buffer.from(JSON.stringify(cursorFor(last)), "utf8").toString(
            "base64url"
          )
        : null,
  };
};
