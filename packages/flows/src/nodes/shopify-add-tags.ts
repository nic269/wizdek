import { MAIN_OUTPUT } from "../definition/node-spec";
import { shopifyAddTagsSpec } from "../definition/specs/shopify-add-tags";
import { defineNode, FlowItemError } from "../registry/define-node";

const TAGS_ADD_MUTATION = `mutation FlowTagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

interface TagsAddData {
  tagsAdd: {
    node: { id: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  } | null;
}

/**
 * Adds tags to a resource. Shopify ignores tags that are already present, so
 * running this again for the same item changes nothing.
 */
export const shopifyAddTagsNode = defineNode(
  shopifyAddTagsSpec,
  async ({ config, ctx, item }) => {
    const resourceId = ctx.resolve(config.resourceId, item);
    if (typeof resourceId !== "string" || !resourceId) {
      throw new FlowItemError("The resource to tag is empty for this item.");
    }
    const tags = config.tags
      .map((tag) => String(ctx.resolve(tag, item) ?? "").trim())
      .filter(Boolean);
    if (tags.length === 0) {
      throw new FlowItemError("No tag resolved to a value for this item.");
    }

    const data = await ctx.shopify.request<TagsAddData>(TAGS_ADD_MUTATION, {
      id: resourceId,
      tags,
    });
    const userErrors = data.tagsAdd?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new FlowItemError(
        userErrors.map(({ message }) => message).join("; ")
      );
    }

    return {
      outputs: [
        { handle: MAIN_OUTPUT, json: { ...item.json, tagsAdded: tags } },
      ],
    };
  }
);
