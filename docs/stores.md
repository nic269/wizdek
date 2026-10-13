# Connecting Shopify stores

Stores belong to an organization. Anyone with the `stores:read` permission sees them; connecting, reconnecting and disconnecting need `stores:manage`, which Owners and Admins have by default. Use the organization switcher in the top bar to choose which organization you are working in.

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
3. For OAuth, add the redirect URL shown on the **Connect store → OAuth install** tab to the app's allowed redirect URLs. It is `<app URL>/api/shopify/oauth/callback`.
4. In the toolkit, enter the name, client ID, client secret and the same scopes. Optionally paste the app's install link.
5. Choose the token mode. Non-expiring offline tokens need no upkeep. Expiring offline tokens last one hour and are refreshed automatically; choose this when the app is configured for expiring tokens.

The client secret is stored encrypted and is never shown again. To rotate it, edit the app and enter the new secret. Stores connected through the app then show their health check as not yet run; check them to confirm they still work.

An app cannot be deleted while stores are connected through it.

## Connecting a store

Open **Stores → Connect store** and pick a tab.

- **Access token.** Enter the domain (`your-store.myshopify.com`) and the token. The token is checked against Shopify before the store is saved.
- **App credentials.** Pick the app and enter one domain per line. Each domain gets its own result, so one failure does not block the others.
- **OAuth install.** Pick the app and enter the domain, then choose **Continue to Shopify** and approve the install. Shopify sends you back and the store becomes connected. The link is valid for 10 minutes and works once. You must stay signed in to the toolkit in the same browser.

To reconnect a store, connect the same domain again; the existing store is updated. A store that is already connected one way must be disconnected before it can be switched to OAuth.

## Store status

| Status | Meaning |
|--------|---------|
| Connected | The last check reached the store with working credentials |
| Pending install | An OAuth install was started and not finished |
| Reconnect required | Shopify rejected the credentials (for example the app was uninstalled or the token revoked) |
| Disconnected | Credentials were removed in the toolkit |

**Check health** calls the store and refreshes its name, currency and granted scopes. **Disconnect** deletes the stored tokens; it does not uninstall the app from the store.

## Operating notes

- `SHOPIFY_TOKEN_ENCRYPTION_KEY` encrypts every stored token and client secret. Back it up with the database. If it is lost or changed, every store must be reconnected.
- OAuth needs a URL Shopify can redirect to. Shopify may refuse an `http://localhost` redirect URL; if it does, run the app behind a tunnel or on its deployed host and register that URL instead. The access-token and app-credentials methods are unaffected.
- Connection events (app created, updated, deleted; store connected, OAuth started, disconnected) are written to the organization's audit log. Tokens and secrets are never included.
