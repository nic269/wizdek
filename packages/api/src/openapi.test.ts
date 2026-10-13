import { PERMISSION_CATALOG } from "@repo/access-control";
import { describe, expect, it } from "vitest";
import { contract } from "./contracts";
import { getOpenApiDocument } from "./openapi";

interface JsonSchemaNode {
  anyOf?: JsonSchemaNode[];
  const?: unknown;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
}

const contentSchema = (value: unknown) =>
  (
    value as {
      content?: { "application/json"?: { schema?: JsonSchemaNode } };
    }
  ).content?.["application/json"]?.schema;

describe("openapi document", () => {
  it("generates paths from the oRPC contract", async () => {
    const openApiDocument = await getOpenApiDocument();

    expect(openApiDocument.paths).toBeDefined();
    expect(openApiDocument.paths?.["/status"]?.get?.operationId).toBe(
      "status.get.rest"
    );
    expect(openApiDocument.paths?.["/rpc/status.get"]).toBeUndefined();
    expect(
      openApiDocument.paths?.["/api/organizations/{organizationId}/members"]
        ?.get?.operationId
    ).toBe("organizations.members.list");
  });

  it("keeps runtime routes and generated documentation on one contract", async () => {
    const openApiDocument = await getOpenApiDocument();

    expect(contract.organizations.create["~orpc"].route.path).toBe(
      "/api/organizations"
    );
    expect(
      openApiDocument.paths?.["/api/organizations"]?.post?.operationId
    ).toBe(contract.organizations.create["~orpc"].route.operationId);
  });

  it("documents the same error envelope returned by the Hono adapter", async () => {
    const openApiDocument = await getOpenApiDocument();
    const response =
      openApiDocument.paths?.["/api/organizations"]?.post?.responses?.["422"];
    expect(response).toMatchObject({
      content: {
        "application/json": {
          schema: {
            properties: {
              error: {
                required: ["code", "message"],
              },
            },
            required: ["error"],
          },
        },
      },
    });
  });

  it("documents exact permission pairs and truthful status literals", async () => {
    const openApiDocument = await getOpenApiDocument();
    const rolesPath =
      openApiDocument.paths?.["/api/organizations/{organizationId}/roles"];
    const permissionAlternatives = contentSchema(rolesPath?.post?.requestBody)
      ?.properties?.permissions?.items?.anyOf;
    const documentedPermissions = permissionAlternatives?.map((schema) => ({
      action: schema.properties?.action?.const,
      module: schema.properties?.module?.const,
    }));

    expect(documentedPermissions).toEqual(
      PERMISSION_CATALOG.map(({ action, module }) => ({ action, module }))
    );
    expect(documentedPermissions).not.toContainEqual({
      action: "manage",
      module: "audit",
    });

    const membersResponse =
      openApiDocument.paths?.["/api/organizations/{organizationId}/members"]
        ?.get?.responses?.["200"];
    const memberStatus =
      contentSchema(membersResponse)?.properties?.data?.items?.properties
        ?.status?.const;
    expect(memberStatus).toBe("ACTIVE");

    const invitationCreateResponse =
      openApiDocument.paths?.["/api/organizations/{organizationId}/invitations"]
        ?.post?.responses?.["201"];
    const createdStatus = contentSchema(invitationCreateResponse)?.properties
      ?.data?.properties?.status?.const;
    expect(createdStatus).toBe("PENDING");
  });
});
