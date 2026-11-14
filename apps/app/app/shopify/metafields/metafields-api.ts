import { apiClient } from "@repo/api/client";
import { isMixed, needsMetaobject } from "./metaobject-validation";

export interface Definition {
  description: string | null;
  id: string;
  key: string;
  name: string;
  namespace: string;
  type: { name: string };
}
export interface Draft {
  created?: boolean;
  description: string;
  id: string;
  key: string;
  metaobjectIds?: string[];
  name: string;
  namespace: string;
  result?: string;
  type: string;
}
export const newDraft = (): Draft => ({
  description: "",
  id: crypto.randomUUID(),
  key: "",
  name: "",
  namespace: "custom",
  type: "single_line_text_field",
});

export const LIST = `query Definitions($ownerType: MetafieldOwnerType!, $after: String) {
  metafieldDefinitions(ownerType: $ownerType, first: 100, after: $after) {
    nodes { id name namespace key description type { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const CREATE = `mutation CreateDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message } }
}`;
export const UPDATE = `mutation UpdateDefinition($definition: MetafieldDefinitionUpdateInput!) {
  metafieldDefinitionUpdate(definition: $definition) { updatedDefinition { id } userErrors { field message } }
}`;
export const DELETE = `mutation DeleteDefinition($id: ID!, $deleteValues: Boolean!) {
  metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteValues) { deletedDefinitionId userErrors { field message } }
}`;

/** Uses the existing authenticated, permission-checked and audited GraphQL proxy. */
export async function execute<T>(
  storeId: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { data } = await apiClient.shopifyGraphql.execute({
    query,
    storeId,
    variables,
  });
  return readResponse<T>(data.body, data.httpStatus);
}

export function readResponse<T>(body: unknown, status: number): T {
  const response = body as { data?: T; errors?: { message: string }[] } | null;
  if (status >= 400 || response?.errors?.length || !response?.data) {
    throw new Error(
      response?.errors?.map((error) => error.message).join("; ") ||
        `Shopify request failed (${status}).`
    );
  }
  return response.data;
}

export interface MutationPayload {
  createdDefinition?: { id: string } | null;
  deletedDefinitionId?: string | null;
  updatedDefinition?: { id: string } | null;
  userErrors: { field?: string[]; message: string }[];
}
export function checkMutation(payload: MutationPayload | null | undefined) {
  if (!payload) {
    throw new Error(
      "Shopify returned no mutation result. Refresh before retrying."
    );
  }
  if (payload.userErrors.length) {
    throw new Error(
      payload.userErrors.map((error) => error.message).join("; ")
    );
  }
  if (
    !(
      payload.createdDefinition?.id ||
      payload.updatedDefinition?.id ||
      payload.deletedDefinitionId
    )
  ) {
    throw new Error(
      "Shopify did not confirm the change. Refresh before retrying."
    );
  }
}

const NAMESPACE_PATTERN = /^[\w-]{3,255}$/;
const KEY_PATTERN = /^[\w-]{2,64}$/;

export function validateDrafts(rows: Draft[]): string | null {
  const seen = new Set<string>();
  for (const row of rows.filter((item) => !item.created)) {
    if (!row.name.trim() || row.name.trim().length > 255) {
      return "Each name must contain 1–255 characters.";
    }
    if (!NAMESPACE_PATTERN.test(row.namespace)) {
      return "Namespaces need 3–255 letters, numbers, underscores or hyphens.";
    }
    if (!KEY_PATTERN.test(row.key)) {
      return "Keys need 2–64 letters, numbers, underscores or hyphens.";
    }
    if (row.description.length > 65_535) {
      return "Descriptions must be at most 65,535 characters.";
    }
    if (
      needsMetaobject(row.type) &&
      (!row.metaobjectIds?.length ||
        (!isMixed(row.type) && row.metaobjectIds.length !== 1))
    ) {
      return `Choose the allowed metaobject definition(s) for ${row.name}.`;
    }
    const identifier = `${row.namespace}.${row.key}`;
    if (seen.has(identifier)) {
      return `Duplicate definition: ${identifier}.`;
    }
    seen.add(identifier);
  }
  return null;
}

export async function listDefinitions(
  storeId: string,
  ownerType: string
): Promise<Definition[]> {
  const result: Definition[] = [];
  let after: string | null = null;
  do {
    const data: {
      metafieldDefinitions: {
        nodes: Definition[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await execute(storeId, LIST, { after, ownerType });
    result.push(...data.metafieldDefinitions.nodes);
    const page = data.metafieldDefinitions.pageInfo;
    if (page.hasNextPage && (!page.endCursor || after === page.endCursor)) {
      throw new Error("Invalid definition pagination cursor.");
    }
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);
  return result;
}
