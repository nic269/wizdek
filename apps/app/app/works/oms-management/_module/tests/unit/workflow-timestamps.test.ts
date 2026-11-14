import { describe, expect, it } from "vitest";
import { workflowTimestamps } from "../../server/services/workflow-logs";

describe("workflow JSON timestamps", () => {
  it("interprets timestamp-without-time-zone values as UTC", () => {
    expect(
      workflowTimestamps({
        startedAt: "2026-11-14T03:49:57.123",
        updatedAt: "2026-11-14 04:00:00",
      })
    ).toEqual({
      startedAt: "2026-11-14T03:49:57.123Z",
      updatedAt: "2026-11-14T04:00:00.000Z",
    });
  });
  it("preserves explicit offsets and leaves unrelated payload timestamps alone", () => {
    const summary = { updatedAt: "2026-11-14T10:00:00" };
    expect(
      workflowTimestamps({
        startedAt: "2026-11-14T10:00:00+07:00",
        summary,
        updatedAt: "2026-11-14T03:00:00Z",
      })
    ).toEqual({
      startedAt: "2026-11-14T03:00:00.000Z",
      summary,
      updatedAt: "2026-11-14T03:00:00.000Z",
    });
  });
  it("retains absent optional fields", () => {
    expect(workflowTimestamps({ id: "run", startedAt: null })).toEqual({
      id: "run",
      startedAt: null,
    });
  });
});
