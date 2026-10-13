# GraphQL console

The console at `/graphql` runs Shopify Admin GraphQL against a connected store. It embeds GraphiQL with the Explorer, so you can tick fields to write a query, read the schema docs, and use autocomplete.

## Using it

1. Pick a store. Only stores with the status Connected are listed.
2. Pick an API version. The list comes from the store; the store's own version is selected first. Changing the store or the version reloads the schema and keeps your open tabs.
3. Write a query, or open the Explorer in the left sidebar and tick fields. To write a mutation in the Explorer, choose **Mutation** next to **Add new** and press **+**.
4. Run it. The response pane shows Shopify's JSON unchanged.

Turn on **Return detailed cost** to ask Shopify for a per-field cost breakdown in `extensions.cost.fields`.

The bar under the response summarises the last run:

| Item | Meaning |
|------|---------|
| HTTP | Shopify's HTTP status. 400 means the document did not parse and was not sent. |
| GraphQL errors | Entries in the top-level `errors` list |
| User errors | Entries in `userErrors` lists inside mutation payloads. A mutation can return HTTP 200 and still report these. |
| Requested / actual cost | Query cost before and after execution |
| Throttle | Points available now, the bucket size, and the restore rate per second |
| Request ID | Shopify's request id, useful when contacting Shopify support |

Tabs, history and settings are kept in the browser, separately for each user and organization. **Saved queries** in the sidebar are stored on the server and shared with everyone in the organization. Anyone who can use the console can save and load them; only the person who saved a query, or someone who can manage stores, can rename or delete it.

The console is a desktop tool. At phone width an open sidebar panel leaves no room for the editor.

## Permissions

| Action | Permission |
|--------|------------|
| Open the console, run queries, load the schema, use saved queries | `graphql:query` |
| Run mutations | `graphql:mutate` |

Members have both by default. Viewers have neither. To let someone read but not write, give them a custom role with `graphql:query` only.

The permission is decided on the server from the parsed document, not from anything the browser says. A document with several operations is judged by the operation that will run, so it needs an operation name. Subscriptions are refused. When permission fails, nothing is sent to Shopify.

Anyone with `graphql:query` can read whatever the store's token can read, including customer data. That is intended for an internal tool; choose the app's scopes and the people you grant the permission to accordingly.

## What is audited

Every execution except schema introspection writes an audit entry (`shopify.graphql.query` or `shopify.graphql.mutation`) with: who ran it, the store, operation type and name, API version, HTTP status, GraphQL and user error counts, requested and actual cost, duration, Shopify's request id, a SHA-256 of the document, the document text, and the variables as sent. If the request fails in transit the attempt is still recorded, because a mutation may have reached Shopify.

Variables often contain customer data, so the audit log now holds customer data. Everyone with the `audit:read` permission can read it, and the Viewer role includes that permission. Review who holds `audit:read`, and put a retention policy in place before the product is opened beyond internal use.

Console entries can be numerous. The audit list under **Settings → Access** has a filter, so membership and role events are easy to find; choose **GraphQL console** to see only executions.

## Limits

| Limit | Value |
|-------|-------|
| Document size | 500 KB |
| Variables size | 1 MB as JSON |
| Time allowed for Shopify to answer | 25 seconds |
| Time the app's `/api` proxy waits for the API | 30 seconds (`experimental.proxyTimeout` in `apps/app/next.config.ts`) |

The 25-second limit is deliberately below the proxy's 30 seconds, so the console always receives an answer or a clear timeout from the API rather than a dropped connection. If a mutation times out, check the store before retrying: Shopify may still have applied it.

Headers typed into GraphiQL are not forwarded; the header editor is turned off. The store's access token is attached inside the API process and never reaches the browser.

Requests to `/api/shopify/*` that carry an `Origin` header other than the app's own URL are refused. This backs up the session cookie's same-site protection on the routes that can change store data.

## Schema loading

The console fetches the schema through the API each time it loads or the store or version changes. The Admin API schema is several megabytes. The response is not cached on the server. Loading time has not yet been measured against a real store; if it exceeds five seconds there, the planned response is a server-side cache of the introspection result per store and API version with a 24-hour lifetime.

## Related

- [Decision 0003](./decisions/0003-graphiql-bundling.md) records why GraphiQL is bundled with the default Next.js toolchain.
- [Connecting Shopify stores](./stores.md) covers getting a store to the Connected status.
