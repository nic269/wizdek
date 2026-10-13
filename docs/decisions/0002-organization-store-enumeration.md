# Decision 0002: No automatic listing of an organization's Shopify stores

- Status: accepted
- Date: 2026-10-13

## Question

Can the toolkit list every store of a Shopify organization, so a user picks stores from a list instead of typing domains?

## Findings

A time-boxed search of Shopify's documentation found no supported API for this.

- The Admin API is scoped to one shop. A token for one store says nothing about its sibling stores.
- The Partner API is scoped to a Partner organization, but its documentation describes access to transactions, app events and Experts Marketplace conversations. It documents no query that lists the organization's stores. Source: `https://shopify.dev/docs/api/partner`.
- The client credentials grant needs the shop domain as input (`POST https://{shop}.myshopify.com/admin/oauth/access_token`) and works only when the app and the store belong to the same Shopify organization. It can confirm that a known domain is reachable; it cannot discover domains. Source: `https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant`.
- The Shopify CLI can list stores for a signed-in user, but it does so with its own first-party client. Reusing that client to obtain collaborator access is out of scope for this product (see decision 0001).

One limit of this check: the Partner API's full query list could not be rendered during the search, so the statement above rests on the API's overview page rather than on a field-by-field read of its schema.

## Decision

Do not add an "import from organization" action. The delivered path is the multi-domain input on the Connect page: register one app, then paste the domains of the stores in that app's Shopify organization. The API accepts ten domains per request and reports a result for each, and the UI sends longer lists in chunks.

## Revisit when

Shopify documents a store-listing query on the Partner API or a Dev Dashboard API. The import action would then feed the existing `connectClientCredentials` route and needs no change to the connection model.
