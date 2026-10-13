import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { contract } from "./contracts";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

export const createOpenApiDocument = () =>
  generator.generate(contract, {
    customErrorResponseBodySchema: () => ({
      properties: {
        error: {
          properties: {
            code: { type: "string" },
            details: {},
            message: { type: "string" },
            requestId: { type: "string" },
          },
          required: ["code", "message"],
          type: "object",
        },
      },
      required: ["error"],
      type: "object",
    }),
    info: {
      title: "Shopify Toolkit API",
      version: "0.1.0",
    },
  });

let openApiDocumentPromise:
  | ReturnType<typeof createOpenApiDocument>
  | undefined;

export const getOpenApiDocument = () => {
  openApiDocumentPromise ??= createOpenApiDocument();
  return openApiDocumentPromise;
};
