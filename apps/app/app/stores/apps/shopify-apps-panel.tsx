"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  LoadingState,
} from "@repo/design-system";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import type { ShopifyApp } from "../store-labels";

type TokenMode = ShopifyApp["tokenMode"];

interface AppForm {
  clientId: string;
  clientSecret: string;
  installLink: string;
  name: string;
  scopes: string;
  tokenMode: TokenMode;
}

const EMPTY_FORM: AppForm = {
  clientId: "",
  clientSecret: "",
  installLink: "",
  name: "",
  scopes: "",
  tokenMode: "NON_EXPIRING",
};

const SCOPE_SEPARATOR = /[\s,]+/;
const selectClassName =
  "h-10 w-full rounded-md border bg-background px-3 text-sm";

const parseScopes = (value: string) =>
  value
    .split(SCOPE_SEPARATOR)
    .map((scope) => scope.trim())
    .filter(Boolean);

const toForm = (app: ShopifyApp): AppForm => ({
  clientId: app.clientId,
  clientSecret: "",
  installLink: app.installLink ?? "",
  name: app.name,
  scopes: app.scopes.join(", "),
  tokenMode: app.tokenMode,
});

export function ShopifyAppsPanel() {
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const organizationId = organization?.id;
  const [apps, setApps] = useState<ShopifyApp[] | null>(null);
  const [form, setForm] = useState<AppForm>(EMPTY_FORM);
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadApps = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    const { data } = await apiClient.shopifyApps.list({ organizationId });
    setApps(data);
  }, [organizationId]);

  useEffect(() => {
    setApps(null);
    setError(null);
    loadApps().catch((cause: unknown) =>
      setError(getApiErrorMessage(cause, "Could not load Shopify apps."))
    );
  }, [loadApps]);

  const setField = <TKey extends keyof AppForm>(
    key: TKey,
    value: AppForm[TKey]
  ) => setForm((current) => ({ ...current, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingAppId(null);
  };

  const saveApp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    const shared = {
      name: form.name,
      organizationId,
      scopes: parseScopes(form.scopes),
      tokenMode: form.tokenMode,
    };
    try {
      if (editingAppId) {
        await apiClient.shopifyApps.update({
          ...shared,
          appId: editingAppId,
          installLink: form.installLink || null,
          ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        });
      } else {
        await apiClient.shopifyApps.create({
          ...shared,
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          ...(form.installLink ? { installLink: form.installLink } : {}),
        });
      }
      resetForm();
      await loadApps();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the app."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteApp = async (appId: string) => {
    if (!organizationId) {
      return;
    }
    setError(null);
    try {
      await apiClient.shopifyApps.delete({ appId, organizationId });
      await loadApps();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not delete the app."));
    }
  };

  if (organizationError) {
    return <ErrorState message={organizationError} />;
  }
  if (isLoading || (apps === null && !error)) {
    return <LoadingState label="Loading Shopify apps" />;
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
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Registered apps</CardTitle>
          <CardDescription>
            Client secrets are stored encrypted and never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <ErrorState message={error} /> : null}
          {apps?.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No app registered yet.
            </p>
          ) : null}
          {apps && apps.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {apps.map((app) => (
                <li
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  key={app.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{app.name}</p>
                    <p className="truncate text-muted-foreground text-xs">
                      {app.clientId} · {app.storeCount} store
                      {app.storeCount === 1 ? "" : "s"} ·{" "}
                      {app.tokenMode === "EXPIRING"
                        ? "expiring tokens"
                        : "non-expiring tokens"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => {
                        setEditingAppId(app.id);
                        setForm(toForm(app));
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Edit
                    </Button>
                    <Button
                      disabled={app.storeCount > 0}
                      onClick={() => deleteApp(app.id)}
                      size="sm"
                      title={
                        app.storeCount > 0
                          ? "Remove its stores before deleting the app."
                          : undefined
                      }
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingAppId ? "Edit app" : "Register an app"}</CardTitle>
          <CardDescription>
            Copy the client ID and secret from the app's settings in the Shopify
            Dev Dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={saveApp}>
            <Input
              aria-label="App name"
              maxLength={80}
              minLength={2}
              onChange={(event) => setField("name", event.target.value)}
              placeholder="App name"
              required
              value={form.name}
            />
            <Input
              aria-label="Client ID"
              disabled={Boolean(editingAppId)}
              onChange={(event) => setField("clientId", event.target.value)}
              placeholder="Client ID"
              required
              value={form.clientId}
            />
            <Input
              aria-label="Client secret"
              autoComplete="off"
              onChange={(event) => setField("clientSecret", event.target.value)}
              placeholder={
                editingAppId
                  ? "New client secret (leave blank to keep)"
                  : "Client secret"
              }
              required={!editingAppId}
              type="password"
              value={form.clientSecret}
            />
            <Input
              aria-label="Scopes"
              onChange={(event) => setField("scopes", event.target.value)}
              placeholder="read_orders, write_orders"
              value={form.scopes}
            />
            <Input
              aria-label="Install link"
              onChange={(event) => setField("installLink", event.target.value)}
              placeholder="Install link (optional)"
              type="url"
              value={form.installLink}
            />
            <select
              aria-label="Token mode"
              className={selectClassName}
              onChange={(event) =>
                setField("tokenMode", event.target.value as TokenMode)
              }
              value={form.tokenMode}
            >
              <option value="NON_EXPIRING">Non-expiring offline tokens</option>
              <option value="EXPIRING">
                Expiring offline tokens (refreshed automatically)
              </option>
            </select>
            <div className="flex gap-2">
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? "Saving..." : "Save app"}
              </Button>
              {editingAppId ? (
                <Button onClick={resetForm} type="button" variant="ghost">
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
