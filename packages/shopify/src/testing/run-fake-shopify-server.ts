import { startFakeShopifyServer } from "./fake-shopify-server";

/**
 * Runs the fake Shopify server as its own process for the browser test suite.
 * FAKE_SHOPIFY_PORT picks the port; FAKE_SHOPIFY_ACCEPT_TOKENS is a
 * comma-separated list of access tokens the Admin endpoint accepts.
 */
const port = Number(process.env.FAKE_SHOPIFY_PORT ?? 3999);
const tokens = (process.env.FAKE_SHOPIFY_ACCEPT_TOKENS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

const server = await startFakeShopifyServer({ port });
for (const token of tokens) {
  server.acceptToken(token);
}
console.log(`Fake Shopify server listening on ${server.url}`);

const shutdown = () => {
  server.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
