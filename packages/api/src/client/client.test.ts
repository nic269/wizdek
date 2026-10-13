import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { createApiClient } from "./shared";

describe("oRPC API client", () => {
  it("calls the OpenAPI handler through the shared contract", async () => {
    let requestedUrl = "";
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: (request) => {
        requestedUrl =
          request instanceof Request ? request.url : request.toString();
        return Promise.resolve(
          Response.json({
            ok: true,
            service: "api",
            time: "2030-01-01T00:00:00.000Z",
          })
        );
      },
    });

    await expect(client.health.status({})).resolves.toMatchObject({
      ok: true,
      service: "api",
    });
    expect(requestedUrl).toBe("http://api.test/status");
  });

  it("decodes the existing API error envelope into an ORPCError", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Invalid request details.",
              },
            },
            { status: 422 }
          )
        ),
    });

    const error = await client.organizations
      .create({ name: "x" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });
});
