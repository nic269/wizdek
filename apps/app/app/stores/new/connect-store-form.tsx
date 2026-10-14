"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  LoadingState,
} from "@repo/design-system";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system/components/ui/tabs";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import { OptionSelect } from "../../lib/option-select";
import type { ShopifyApp } from "../store-labels";

type OAuthStart = Awaited<
  ReturnType<typeof apiClient.shopifyStores.beginOAuth>
>["data"];

interface ConnectResult {
  error: string | null;
  ok: boolean;
  shopDomain: string;
}

/** The API accepts ten domains per request; longer lists go in chunks. */
const DOMAINS_PER_REQUEST = 10;
const DOMAIN_SEPARATOR = /[\s,]+/;
const DOMAIN_PLACEHOLDER = "your-store.myshopify.com";

function AppSelect({
  appId,
  apps,
  onChange,
}: {
  appId: string;
  apps: ShopifyApp[];
  onChange: (appId: string) => void;
}) {
  if (apps.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No Shopify app is registered yet.{" "}
        <a
          className="font-medium text-foreground underline"
          href="/stores/apps"
        >
          Register an app
        </a>{" "}
        first.
      </p>
    );
  }
  return (
    <OptionSelect
      aria-label="Shopify app"
      onValueChange={onChange}
      options={apps.map((app) => ({ label: app.name, value: app.id }))}
      placeholder="Choose an app"
      value={appId || null}
    />
  );
}

export function ConnectStoreForm({
  initialShopDomain,
}: {
  initialShopDomain: string;
}) {
  const router = useRouter();
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const organizationId = organization?.id;
  const [apps, setApps] = useState<ShopifyApp[]>([]);
  const [appId, setAppId] = useState("");
  const [shopDomain, setShopDomain] = useState(initialShopDomain);
  const [accessToken, setAccessToken] = useState("");
  const [domainList, setDomainList] = useState(initialShopDomain);
  const [results, setResults] = useState<ConnectResult[]>([]);
  const [oauthStart, setOauthStart] = useState<OAuthStart | null>(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setRedirectUrl(`${window.location.origin}/api/shopify/oauth/callback`);
  }, []);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    apiClient.shopifyApps
      .list({ organizationId })
      .then(({ data }) => {
        setApps(data);
        setAppId(data[0]?.id ?? "");
      })
      .catch((cause: unknown) =>
        setError(getApiErrorMessage(cause, "Could not load Shopify apps."))
      );
  }, [organizationId]);

  const submit = async (
    event: FormEvent<HTMLFormElement>,
    action: (organizationId: string) => Promise<void>
  ) => {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await action(organizationId);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not connect the store."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const connectStaticToken = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (id) => {
      await apiClient.shopifyStores.connectStaticToken({
        accessToken,
        organizationId: id,
        shopDomain,
      });
      router.push("/stores");
    });

  const connectClientCredentials = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (id) => {
      const domains = [
        ...new Set(
          domainList
            .split(DOMAIN_SEPARATOR)
            .map((domain) => domain.trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
      setResults([]);
      for (
        let start = 0;
        start < domains.length;
        start += DOMAINS_PER_REQUEST
      ) {
        const { data } = await apiClient.shopifyStores.connectClientCredentials(
          {
            appId,
            organizationId: id,
            shopDomains: domains.slice(start, start + DOMAINS_PER_REQUEST),
          }
        );
        setResults((current) => [...current, ...data]);
      }
    });

  const beginOAuth = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (id) => {
      const { data } = await apiClient.shopifyStores.beginOAuth({
        appId,
        organizationId: id,
        shopDomain,
      });
      setOauthStart(data);
    });

  if (organizationError) {
    return <ErrorState message={organizationError} />;
  }
  if (isLoading) {
    return <LoadingState label="Loading organization" />;
  }
  if (!organization) {
    return (
      <ErrorState
        message="Create an organization on the dashboard first."
        title="No organization"
      />
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {error ? <ErrorState message={error} title="Could not connect" /> : null}
      <Tabs className="flex-col" defaultValue="static-token">
        <TabsList className="h-9">
          <TabsTrigger value="static-token">Access token</TabsTrigger>
          <TabsTrigger value="client-credentials">App credentials</TabsTrigger>
          <TabsTrigger value="oauth">OAuth install</TabsTrigger>
        </TabsList>

        <TabsContent value="static-token">
          <Card>
            <CardHeader>
              <CardTitle>Paste an Admin API access token</CardTitle>
              <CardDescription>
                For a custom app created in the store's own admin. The token is
                checked against Shopify before the store is saved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={connectStaticToken}>
                <Input
                  aria-label="Shop domain"
                  onChange={(event) => setShopDomain(event.target.value)}
                  placeholder={DOMAIN_PLACEHOLDER}
                  required
                  value={shopDomain}
                />
                <Input
                  aria-label="Admin API access token"
                  autoComplete="off"
                  onChange={(event) => setAccessToken(event.target.value)}
                  placeholder="shpat_..."
                  required
                  type="password"
                  value={accessToken}
                />
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Connecting..." : "Connect store"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="client-credentials">
          <Card>
            <CardHeader>
              <CardTitle>Connect with a registered app's credentials</CardTitle>
              <CardDescription>
                Works for stores in the same Shopify organization as the app.
                Enter one domain per line.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={connectClientCredentials}>
                <AppSelect appId={appId} apps={apps} onChange={setAppId} />
                <Textarea
                  aria-label="Shop domains"
                  onChange={(event) => setDomainList(event.target.value)}
                  placeholder={`${DOMAIN_PLACEHOLDER}\nanother-store.myshopify.com`}
                  required
                  rows={5}
                  value={domainList}
                />
                <Button disabled={isSubmitting || !appId} type="submit">
                  {isSubmitting ? "Connecting..." : "Connect stores"}
                </Button>
              </form>
              {results.length > 0 ? (
                <ul className="mt-4 divide-y rounded-md border text-sm">
                  {results.map((result) => (
                    <li
                      className="flex items-start justify-between gap-3 px-3 py-2"
                      key={result.shopDomain}
                    >
                      <span className="font-medium">{result.shopDomain}</span>
                      <span
                        className={
                          result.ok
                            ? "text-muted-foreground"
                            : "text-destructive"
                        }
                      >
                        {result.ok ? "Connected" : result.error}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oauth">
          <Card>
            <CardHeader>
              <CardTitle>Install a registered app on the store</CardTitle>
              <CardDescription>
                For stores outside the app's Shopify organization. Add this
                redirect URL to the app configuration in Shopify first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">
                {redirectUrl}
              </code>
              <form className="space-y-3" onSubmit={beginOAuth}>
                <AppSelect appId={appId} apps={apps} onChange={setAppId} />
                <Input
                  aria-label="Shop domain for OAuth"
                  onChange={(event) => setShopDomain(event.target.value)}
                  placeholder={DOMAIN_PLACEHOLDER}
                  required
                  value={shopDomain}
                />
                <Button disabled={isSubmitting || !appId} type="submit">
                  {isSubmitting ? "Preparing..." : "Prepare install"}
                </Button>
              </form>
              {oauthStart ? (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p>
                    {oauthStart.store.shopDomain} is waiting for the install.
                    The link is valid for 10 minutes.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      className={buttonVariants()}
                      href={oauthStart.authorizeUrl}
                    >
                      Continue to Shopify
                    </a>
                    {oauthStart.installLink ? (
                      <a
                        className={buttonVariants({ variant: "outline" })}
                        href={oauthStart.installLink}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open the app's install link
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
