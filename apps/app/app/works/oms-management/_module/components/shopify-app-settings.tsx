"use client";
import { Button, Plus, Trash2 } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useState } from "react";
import type { PublicProfile } from "../lib/contracts";
import type { ShopifyAppConfig, SiteConfigData } from "../lib/site-config";
import {
  ChoiceSelect,
  ErrorNotice,
  FormField,
  Panel,
  TextField,
} from "./oms-ui";
import { OperationButton } from "./operation-controls";

const API_VERSION_PATTERN = /^\d{4}-\d{2}$/;
const LIST_SEPARATOR = /[\n,]+/;
const TIMEZONES = [
  { label: "Hong Kong (Asia/Hong_Kong)", value: "Asia/Hong_Kong" },
  { label: "Japan (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "Vietnam (Asia/Ho_Chi_Minh)", value: "Asia/Ho_Chi_Minh" },
  { label: "US Pacific (America/Los_Angeles)", value: "America/Los_Angeles" },
  { label: "US Eastern (America/New_York)", value: "America/New_York" },
  { label: "UTC", value: "UTC" },
];

export function GeneralSiteSettings({
  profile,
  settings,
  version,
  setDirty,
}: {
  profile: PublicProfile;
  settings: SiteConfigData["settings"];
  version: string;
  setDirty: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  function update(key: keyof typeof draft, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(settings));
  }
  const timezones = TIMEZONES.some((item) => item.value === draft.siteTimezone)
    ? TIMEZONES
    : [...TIMEZONES, { label: draft.siteTimezone, value: draft.siteTimezone }];
  return (
    <Panel
      action={
        <OperationButton
          action="shopify.settings.update"
          disabled={
            !(
              changed &&
              API_VERSION_PATTERN.test(draft.shopifyApiVersion.trim())
            )
          }
          expectedVersion={version}
          label="Save Settings"
          onComplete={() => setDirty(false)}
          payload={draft}
          profile={profile}
        />
      }
      title="Site general configurations"
    >
      <div className="divide-y divide-border">
        <div className="grid gap-3 pb-4 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-center">
          <span className="font-medium text-sm">Shopify API version</span>
          <TextField
            id="site-shopify-version"
            label={<span className="sr-only">Shopify API version</span>}
            onChange={(event) =>
              update("shopifyApiVersion", event.target.value)
            }
            placeholder="2026-04"
            value={draft.shopifyApiVersion}
          />
        </div>
        <div className="grid gap-3 py-4 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-center">
          <label className="font-medium text-sm" htmlFor="site-shopify-scopes">
            Shopify required scopes
          </label>
          <Textarea
            id="site-shopify-scopes"
            onChange={(event) =>
              update("shopifyRequiredScopes", event.target.value)
            }
            rows={3}
            value={draft.shopifyRequiredScopes}
          />
        </div>
        <div className="grid gap-3 pt-4 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-center">
          <span className="font-medium text-sm">Site timezone</span>
          <ChoiceSelect
            choices={timezones}
            id="site-timezone"
            label={<span className="sr-only">Site timezone</span>}
            onValueChange={(value) => update("siteTimezone", value)}
            value={draft.siteTimezone}
          />
        </div>
      </div>
    </Panel>
  );
}

interface AppForm {
  clientId: string;
  clientSecret: string;
  installLink: string;
  name: string;
  original: ShopifyAppConfig | null;
  scopes: string;
  status: "ACTIVE" | "DISABLED";
  storeDomains: string;
}

export function ShopifyAppsSettings({
  profile,
  apps,
  available,
  apiVersion,
  requiredScopes,
  setDirty,
}: {
  profile: PublicProfile;
  apps: ShopifyAppConfig[];
  available: boolean;
  apiVersion: string;
  requiredScopes: string;
  setDirty: (value: boolean) => void;
}) {
  const [form, setForm] = useState<AppForm | null>(null);
  const [deleting, setDeleting] = useState<ShopifyAppConfig | null>(null);
  const [confirmation, setConfirmation] = useState("");
  function edit(app: ShopifyAppConfig | null) {
    setForm({
      clientId: app?.clientId ?? "",
      clientSecret: "",
      installLink: app?.installLink ?? "",
      name: app?.name ?? "",
      original: app,
      scopes: app?.scopes.join(",") ?? requiredScopes,
      status: app?.status ?? "ACTIVE",
      storeDomains: app?.availableStoreDomains.join("\n") ?? "",
    });
  }
  function update<K extends keyof Omit<AppForm, "original">>(
    key: K,
    value: AppForm[K]
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : null));
    setDirty(true);
  }
  function close() {
    setForm(null);
    setDirty(false);
  }
  const field = (
    key: "name" | "clientId" | "clientSecret" | "installLink",
    label: string,
    type = "text"
  ) => (
    <TextField
      autoComplete={key === "clientSecret" ? "new-password" : "off"}
      id={`custom-app-${key}`}
      label={label}
      onChange={(event) => update(key, event.target.value)}
      type={type}
      value={form?.[key] ?? ""}
      {...(key === "clientSecret"
        ? {
            description: form?.original
              ? "Leave blank to keep the current secret."
              : "Required for a new custom app.",
          }
        : {})}
    />
  );
  return (
    <>
      <Panel
        action={
          <Button
            disabled={
              !(
                available &&
                profile.writable &&
                profile.capabilities.includes("settings:write")
              )
            }
            onClick={() => edit(null)}
            size="sm"
          >
            <Plus />
            Add Custom App
          </Button>
        }
        description="Manage custom app credentials, installation links and available stores."
        title="Shopify custom apps"
      >
        {available && apps.length > 0 ? (
          <div className="space-y-3">
            {apps.map((app) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
                key={app.id}
              >
                <button
                  aria-label={`Edit ${app.name}`}
                  className="min-w-0 flex-1 text-left"
                  onClick={() => edit(app)}
                  type="button"
                >
                  <span className="block font-semibold text-sm">
                    {app.name}
                  </span>
                  <span className="mt-1 block break-all text-muted-foreground text-xs tabular-nums">
                    {app.clientId}
                  </span>
                  <span className="mt-1 block text-muted-foreground text-xs">
                    {app.availableStoreDomains.length
                      ? app.availableStoreDomains.join(", ")
                      : "No stores assigned"}
                  </span>
                  <span className="mt-1 block text-muted-foreground text-xs">
                    {app.scopes.length} scopes ·{" "}
                    {app.hasClientSecret
                      ? "Secret configured"
                      : "No secret configured"}
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={app.status === "ACTIVE" ? "secondary" : "outline"}
                  >
                    {app.status}
                  </Badge>
                  <Button onClick={() => edit(app)} size="sm" variant="outline">
                    Edit
                  </Button>
                  <Button
                    aria-label={`Delete ${app.name}`}
                    disabled={
                      !(
                        profile.writable &&
                        profile.capabilities.includes("settings:write")
                      )
                    }
                    onClick={() => {
                      setDeleting(app);
                      setConfirmation("");
                    }}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {available && apps.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            No custom apps configured. Add a custom app to get started.
          </p>
        ) : null}
        {available ? null : (
          <ErrorNotice message="Custom apps are unavailable with this database's schema or permissions." />
        )}
      </Panel>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        open={!!form}
      >
        {!!form && (
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {form.original ? "Edit Custom App" : "Add Custom App"}
              </DialogTitle>
              <DialogDescription>
                Secrets are encrypted by OMS before storage. The current secret
                is never returned.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid gap-4 sm:grid-cols-2">
                {field("name", "App name")}
                {field("clientId", "Client ID")}
                <div className="sm:col-span-2">
                  {field("clientSecret", "Client secret", "password")}
                </div>
                <div className="sm:col-span-2">
                  {field("installLink", "Install link", "url")}
                </div>
                <FormField
                  className="sm:col-span-2"
                  description="Comma-separated or one scope per line."
                  id="custom-app-scopes"
                  label="Scopes"
                >
                  <Textarea
                    id="custom-app-scopes"
                    onChange={(event) => update("scopes", event.target.value)}
                    value={form.scopes}
                  />
                </FormField>
                <FormField
                  className="sm:col-span-2"
                  description="One store domain per line, for example store-name.myshopify.com."
                  id="custom-app-stores"
                  label="Available for stores"
                >
                  <Textarea
                    id="custom-app-stores"
                    onChange={(event) =>
                      update("storeDomains", event.target.value)
                    }
                    value={form.storeDomains}
                  />
                </FormField>
                <ChoiceSelect
                  choices={[
                    { label: "Active", value: "ACTIVE" },
                    { label: "Disabled", value: "DISABLED" },
                  ]}
                  id="custom-app-status"
                  label="Status"
                  onValueChange={(value) =>
                    update("status", value as AppForm["status"])
                  }
                  value={form.status}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button onClick={close} variant="outline">
                Cancel
              </Button>
              <OperationButton
                action={
                  form.original ? "shopify.app.update" : "shopify.app.create"
                }
                disabled={
                  !(
                    form.name.trim() &&
                    form.clientId.trim() &&
                    form.installLink.trim() &&
                    (form.original || form.clientSecret.trim())
                  )
                }
                expectedVersion={form.original?.updatedAt ?? null}
                label="Save App"
                onComplete={close}
                payload={{
                  apiVersion,
                  appId: form.original?.id,
                  clientId: form.clientId,
                  clientSecret: form.clientSecret,
                  installLink: form.installLink,
                  name: form.name,
                  scopes: form.scopes,
                  status: form.status,
                  storeDomains: form.storeDomains
                    .split(LIST_SEPARATOR)
                    .map((value) => value.trim())
                    .filter(Boolean),
                }}
                profile={profile}
              />
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setConfirmation("");
            setDirty(false);
          }
        }}
        open={!!deleting}
      >
        {!!deleting && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete custom app?</DialogTitle>
              <DialogDescription>
                Type the exact client ID to remove {deleting.name}. This will be
                reviewed before deletion.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="mb-3 break-all text-xs tabular-nums">
                {deleting.clientId}
              </p>
              <TextField
                id="delete-custom-app-client-id"
                label="Confirm client ID"
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setDirty(true);
                }}
                value={confirmation}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                onClick={() => {
                  setDeleting(null);
                  setConfirmation("");
                  setDirty(false);
                }}
                variant="outline"
              >
                Cancel
              </Button>
              <OperationButton
                action="shopify.app.delete"
                disabled={confirmation.trim() !== deleting.clientId}
                expectedVersion={deleting.updatedAt}
                label="Delete App"
                onComplete={() => {
                  setDeleting(null);
                  setConfirmation("");
                  setDirty(false);
                }}
                payload={{ appId: deleting.id, clientId: confirmation.trim() }}
                profile={profile}
              />
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
