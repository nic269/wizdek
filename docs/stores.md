# Connecting Shopify stores

Stores belong to an organization. Anyone with the `stores:read` permission sees them; connecting, reconnecting and disconnecting need `stores:manage`, which Owners and Admins have by default. Use the organization switcher at the top of the sidebar to choose which organization you are working in.

## Choosing a connection method

| Method | Use it when | What you need |
|--------|-------------|---------------|
| Access token | The store has a custom app created in its own admin | The store domain and the app's Admin API access token |
| App credentials | The store is in the same Shopify organization as an app you registered | A registered app and the store domain |
| OAuth install | The store is outside your app's Shopify organization | A registered app, and someone who can install it on the store |

The toolkit cannot list the stores of a Shopify organization, because Shopify offers no supported API for it. You enter the domains yourself. See [decision 0002](./decisions/0002-organization-store-enumeration.md).

## Registering a Shopify app

App credentials and OAuth both go through an app you register once per organization under **Stores → Shopify apps**.

1. In the Shopify Dev Dashboard, create an app (or open an existing one) and select the Admin API scopes the toolkit should have.
2. Copy the client ID and client secret from the app's settings.
3. For OAuth, add the redirect URL shown under **Connect store → OAuth install** to the app's allowed redirect URLs. It is `<app URL>/api/shopify/oauth/callback`.
4. In the toolkit, enter the name, client ID, client secret and the same scopes. Optionally paste the app's install link.
5. Choose the token mode. Non-expiring offline tokens need no upkeep. Expiring offline tokens last one hour and are refreshed automatically; choose this when the app is configured for expiring tokens.

The client secret is stored encrypted and is never shown again. To rotate it, edit the app and enter the new secret. Stores connected through the app then show their health check as not yet run; check them to confirm they still work.

An app cannot be deleted while stores are connected through it.

## Connecting a store

Open **Stores → Connect store**, pick a method (**Which method?** explains the choice), and choose the store's environment: Production, Staging or Development.

- **Access token.** Enter the domain (`your-store.myshopify.com`) and the token. The token is checked against Shopify before the store is saved.
- **App credentials.** Pick the app and enter one domain per line. Each domain gets its own result, so one failure does not block the others.
- **OAuth install.** Pick the app and enter the domain, then choose **Continue to Shopify** and approve the install. Shopify sends you back and the store becomes connected. The link is valid for 10 minutes and works once. You must stay signed in to the toolkit in the same browser.

To reconnect a store, connect the same domain again; the existing store is updated. A store that is already connected one way must be disconnected before it can be switched to OAuth.

## Webhook signing secret

Flows can start from Shopify webhooks. Shopify signs every webhook with the client secret of the app that created the subscription, and the toolkit rejects deliveries whose signature does not match.

- A store connected through a registered app (OAuth install or app credentials) needs nothing more: the app's client secret is already stored.
- A store connected by a pasted access token has no app registered here. Open the store from the Stores page and, under **Webhook secret**, enter the client secret (API secret key) of the custom app the token belongs to. It is stored encrypted and is never displayed; a store manager can copy it from the panel (see [Editing a store](#editing-a-store)).

Until a secret is saved, a webhook flow cannot be activated on such a store.

## Store status

| Status | Meaning |
|--------|---------|
| Connected | The last check reached the store with working credentials |
| Pending install | An OAuth install was started and not finished |
| Reconnect required | Shopify rejected the credentials (for example the app was uninstalled or the token revoked) |
| Disconnected | Credentials were removed in the toolkit |

Selecting a store opens its panel. **Check health** calls the store and refreshes its currency, granted scopes and, unless you renamed it, its name. The environment can be changed there. **Disconnect**, under the danger zone, deletes the stored tokens after a confirmation that counts the runs and activations using the store; it does not uninstall the app from the store.

A store marked Production carries a red PROD tag. The GraphQL console shows a red band for it and asks before sending a mutation, and the Run dialog uses a red button for it.

## Editing a store

People who can manage stores (Owner and Admin) can change a store from its panel, under **Details**:

- **Store name.** By default the name comes from Shopify and is refreshed on every health check. Once you rename a store, health checks and reconnects keep your name. **Use the Shopify name** goes back to the name Shopify reports.
- **Store domain and access token**, for stores connected by an access token. Leave the token empty to keep the current one. The toolkit checks the new domain and token with Shopify before saving, and saves nothing if Shopify refuses them. The domain cannot be changed while a flow is activated on the store, because its webhook subscriptions live on the old shop, and it cannot be one another store in the organization already uses. Stores connected through an app get their tokens from the toolkit, so their domain and token are read-only; reconnect them instead.
- **Copy** next to the access token and the webhook secret puts the value on the clipboard without showing it. Each copy is recorded in the audit log as `shopify.store.secret_revealed`, with which secret was copied but never its value. For a store connected through an app, the copied token is the current one, renewed first if it was about to expire.

## Operating notes

- `SHOPIFY_TOKEN_ENCRYPTION_KEY` encrypts every stored token and client secret, and the URLs of [database connections](./database.md). Back it up with the database. If it is lost or changed, every store must be reconnected and every database connection added again.
- OAuth needs a URL Shopify can redirect to. Shopify may refuse an `http://localhost` redirect URL; if it does, run the app behind a tunnel or on its deployed host and register that URL instead. The access-token and app-credentials methods are unaffected.
- Connection events (app created, updated, deleted; store connected, OAuth started, disconnected, environment changed) are written to the organization's audit log. Tokens and secrets are never included.
