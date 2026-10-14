"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Box,
  Button,
  cn,
  EmptyState,
  ErrorAlert,
  Input,
  Lock,
  PageHeader,
  Plus,
  ReadOnlyBanner,
  SecretInput,
  Shimmer,
  toast,
  X,
} from "@repo/design-system";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import {
  RadioGroup,
  RadioGroupItem,
} from "@repo/design-system/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/design-system/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import { BackLink } from "../../lib/back-link";
import { plural } from "../../lib/format";
import { usePermissions } from "../../lib/permissions";
import { useShopifyApps } from "../../lib/queries";
import type { ShopifyApp } from "../store-labels";

type TokenMode = ShopifyApp["tokenMode"];

const TOKEN_MODES: { description: string; label: string; value: TokenMode }[] =
  [
    {
      description: "Simplest. Token stays valid until the app is uninstalled.",
      label: "Non-expiring offline tokens",
      value: "NON_EXPIRING",
    },
    {
      description:
        "Rotated automatically with a refresh token. Required for newer apps.",
      label: "Expiring offline tokens",
      value: "EXPIRING",
    },
  ];

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

const shortId = (clientId: string) =>
  clientId.length > 10
    ? `${clientId.slice(0, 4)}…${clientId.slice(-4)}`
    : clientId;

const AppCard = ({
  app,
  canManage,
  onDelete,
  onEdit,
}: {
  app: ShopifyApp;
  canManage: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) => {
  const inUse = app.storeCount > 0;
  return (
    <article className="flex flex-col gap-3.5 rounded-card border border-border p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-[34px] place-items-center rounded-lg bg-accent-soft text-accent-ink">
          <Box className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-[14.5px] leading-[1.3]">
            {app.name}
          </h2>
          <p className="truncate font-mono text-muted-foreground text-xs leading-[1.3]">
            client_id {shortId(app.clientId)}
          </p>
        </div>
        <span className="inline-flex h-[22px] items-center rounded-full border border-border bg-sunken px-2 font-medium text-[11.5px] text-foreground-2">
          {app.tokenMode === "EXPIRING"
            ? "Expiring offline"
            : "Non-expiring offline"}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2.5 border-border border-y py-2.5">
        <div>
          <dt className="mb-1.5 text-[11.5px] text-muted-foreground leading-none">
            Stores
          </dt>
          <dd className="font-semibold text-sm leading-none">
            {app.storeCount}
          </dd>
        </div>
        <div>
          <dt className="mb-1.5 text-[11.5px] text-muted-foreground leading-none">
            Scopes
          </dt>
          <dd className="font-semibold text-sm leading-none">
            {app.scopes.length}
          </dd>
        </div>
        <div>
          <dt className="mb-1.5 text-[11.5px] text-muted-foreground leading-none">
            Client secret
          </dt>
          <dd className="flex items-center gap-[5px] font-medium text-[12.5px] text-foreground-2 leading-none">
            <Lock className="size-3" />
            Encrypted
          </dd>
        </div>
      </dl>
      {canManage ? (
        <div className="flex items-center gap-1.5">
          <Button onClick={onEdit} size="sm" variant="outline">
            Edit
          </Button>
          <Button
            className={cn(inUse ? "text-faint" : "text-(--status-danger-fg)")}
            disabled={inUse}
            onClick={onDelete}
            size="sm"
            title={
              inUse ? `In use by ${plural(app.storeCount, "store")}` : undefined
            }
            variant="ghost"
          >
            Delete
          </Button>
          {inUse ? (
            <span className="text-muted-foreground text-xs leading-[1.3]">
              Used by {plural(app.storeCount, "store")} — disconnect{" "}
              {app.storeCount === 1 ? "it" : "them"} to delete.
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};

const AppSheet = ({
  editing,
  onClose,
  onSaved,
  open,
  organizationId,
}: {
  editing: ShopifyApp | null;
  onClose: () => void;
  onSaved: () => void;
  open: boolean;
  organizationId: string;
}) => {
  const [form, setForm] = useState<AppForm>(
    editing ? toForm(editing) : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setField = <TKey extends keyof AppForm>(
    key: TKey,
    value: AppForm[TKey]
  ) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const shared = {
      name: form.name,
      organizationId,
      scopes: parseScopes(form.scopes),
      tokenMode: form.tokenMode,
    };
    try {
      if (editing) {
        await apiClient.shopifyApps.update({
          ...shared,
          appId: editing.id,
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
      toast.success("App saved", {
        description: form.clientSecret
          ? "Client secret stored encrypted."
          : form.name,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the app."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet onOpenChange={(next) => (next ? null : onClose())} open={open}>
      <SheetContent
        className="w-[min(460px,calc(100vw-16px))] gap-0 p-0 sm:max-w-none"
        showCloseButton={false}
        side="right"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
          <div className="flex items-center border-border border-b px-5 py-[18px]">
            <div className="flex-1">
              <SheetTitle className="font-semibold text-base leading-[1.3]">
                {editing ? `Edit ${editing.name}` : "Register an app"}
              </SheetTitle>
              <SheetDescription className="text-[12.5px] text-muted-foreground leading-[1.4]">
                Copy these from the app's settings in the Shopify Dev Dashboard.
              </SheetDescription>
            </div>
            <Button
              aria-label="Close"
              className="text-muted-foreground"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-[17px]" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
            {error ? <ErrorAlert message={error} title="Not saved." /> : null}
            <Field className="gap-1.5">
              <FieldLabel htmlFor="app-name">App name</FieldLabel>
              <Input
                id="app-name"
                maxLength={80}
                minLength={2}
                onChange={(event) => setField("name", event.target.value)}
                placeholder="Wizloft Ops"
                required
                value={form.name}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="app-client-id">Client ID</FieldLabel>
              <Input
                className="font-mono text-[13px]"
                disabled={Boolean(editing)}
                id="app-client-id"
                onChange={(event) => setField("clientId", event.target.value)}
                placeholder="3f9a8b…"
                required
                value={form.clientId}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="app-client-secret">Client secret</FieldLabel>
              <SecretInput
                helper={
                  editing
                    ? "Write-only. Leave blank to keep the stored secret."
                    : "Write-only. Stored encrypted and never shown again."
                }
                id="app-client-secret"
                onChange={(event) =>
                  setField("clientSecret", event.target.value)
                }
                placeholder={
                  editing ? "Paste a new secret to replace it" : "Paste secret"
                }
                required={!editing}
                value={form.clientSecret}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="app-scopes">Scopes</FieldLabel>
              <Input
                className="font-mono text-[13px]"
                id="app-scopes"
                onChange={(event) => setField("scopes", event.target.value)}
                placeholder="read_orders, write_orders"
                value={form.scopes}
              />
              <FieldDescription className="text-xs">
                Comma-separated. Must match the scopes configured in the Dev
                Dashboard.
              </FieldDescription>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="app-install-link">
                Install link{" "}
                <span className="font-normal text-muted-foreground">
                  · optional
                </span>
              </FieldLabel>
              <Input
                className="font-mono text-[13px]"
                id="app-install-link"
                onChange={(event) =>
                  setField("installLink", event.target.value)
                }
                placeholder="https://admin.shopify.com/…"
                type="url"
                value={form.installLink}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-[13px]">Token mode</span>
              <RadioGroup
                aria-label="Token mode"
                className="flex flex-col gap-2"
                onValueChange={(value) =>
                  setField("tokenMode", value as TokenMode)
                }
                value={form.tokenMode}
              >
                {TOKEN_MODES.map((mode) => (
                  <label
                    className={cn(
                      "flex cursor-pointer gap-2.5 rounded-menu border bg-card px-3 py-[11px]",
                      form.tokenMode === mode.value
                        ? "border-accent"
                        : "border-border"
                    )}
                    htmlFor={`token-mode-${mode.value}`}
                    key={mode.value}
                  >
                    <RadioGroupItem
                      className="mt-px"
                      id={`token-mode-${mode.value}`}
                      value={mode.value}
                    />
                    <span>
                      <span className="block font-medium text-[13px] leading-[1.3]">
                        {mode.label}
                      </span>
                      <span className="block text-muted-foreground text-xs leading-[1.4]">
                        {mode.description}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-border border-t px-5 py-3.5">
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Saving…" : "Save app"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export function ShopifyAppsPanel() {
  const queryClient = useQueryClient();
  const { organization } = useActiveOrganization();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const organizationId = organization?.id ?? null;
  const apps = useShopifyApps(organizationId);
  const [sheet, setSheet] = useState<{ app: ShopifyApp | null } | null>(null);
  const canManage = can("stores:manage");
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["shopify-apps", organizationId],
    });

  const deleteApp = async (app: ShopifyApp) => {
    if (!organizationId) {
      return;
    }
    try {
      await apiClient.shopifyApps.delete({ appId: app.id, organizationId });
      toast.success("App deleted", { description: app.name });
      await refresh();
    } catch (cause) {
      toast.error("Could not delete the app", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    }
  };

  const list = apps.data ?? [];
  const isLoading = apps.isLoading || permissionsLoading;

  return (
    <>
      <PageHeader
        actions={
          canManage ? (
            <Button onClick={() => setSheet({ app: null })}>
              <Plus />
              Register app
            </Button>
          ) : null
        }
        back={<BackLink href="/stores">Stores</BackLink>}
        description="Apps from the Shopify Dev Dashboard that wizdek connects stores through. Used by the App credentials and OAuth methods."
        title="Shopify apps"
      />
      {permissionsLoading || canManage ? null : (
        <ReadOnlyBanner>
          You can see the registered apps but not change them. Ask an Owner for
          the <strong>Manage Shopify stores</strong> permission.
        </ReadOnlyBanner>
      )}
      {apps.isError ? (
        <ErrorAlert
          message="Connected stores are unaffected."
          onRetry={() => apps.refetch()}
          title="Couldn't load Shopify apps."
        />
      ) : null}
      {isLoading ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))] gap-3.5"
          role="status"
        >
          <span className="sr-only">Loading Shopify apps</span>
          <Shimmer className="h-40 rounded-card" />
          <Shimmer className="h-40 rounded-card" />
        </div>
      ) : null}
      {!(isLoading || apps.isError) && list.length === 0 ? (
        <EmptyState
          action={
            canManage ? (
              <Button onClick={() => setSheet({ app: null })}>
                <Plus />
                Register your first app
              </Button>
            ) : undefined
          }
          description="Register an app from the Shopify Dev Dashboard to connect stores with app credentials or OAuth. Stores with a pasted token don't need one."
          icon={<Box />}
          title="No app registered yet"
        />
      ) : null}
      {list.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))] gap-3.5">
          {list.map((app) => (
            <AppCard
              app={app}
              canManage={canManage}
              key={app.id}
              onDelete={() => deleteApp(app)}
              onEdit={() => setSheet({ app })}
            />
          ))}
        </div>
      ) : null}
      {organizationId && sheet ? (
        <AppSheet
          editing={sheet.app}
          key={sheet.app?.id ?? "new"}
          onClose={() => setSheet(null)}
          onSaved={refresh}
          open
          organizationId={organizationId}
        />
      ) : null}
    </>
  );
}
