import { execute } from "./metafields-api";

export interface MetaobjectDefinition {
  id: string;
  name: string;
  type: string;
}
export async function listMetaobjects(
  storeId: string
): Promise<MetaobjectDefinition[]> {
  const result: MetaobjectDefinition[] = [];
  let after: string | null = null;
  do {
    const data: {
      metaobjectDefinitions: {
        nodes: MetaobjectDefinition[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await execute(
      storeId,
      "query MetaobjectTypes($after: String) { metaobjectDefinitions(first: 100, after: $after) { nodes { id name type } pageInfo { hasNextPage endCursor } } }",
      { after }
    );
    result.push(...data.metaobjectDefinitions.nodes);
    const page = data.metaobjectDefinitions.pageInfo;
    if (page.hasNextPage && (!page.endCursor || after === page.endCursor)) {
      throw new Error("Invalid metaobject pagination cursor.");
    }
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);
  return result;
}
