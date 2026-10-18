"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Activity,
  Button,
  buttonVariants,
  CircleCheck,
  CircleDashed,
  Copy,
  cn,
  ENVIRONMENT_LABELS,
  type Environment,
  EnvTag,
  ExternalLink,
  IdentityChip,
  InlineAlert,
  KeyRound,
  LoaderCircle,
  SecretInput,
  SegmentedControl,
  ShieldCheck,
  StatusBadge,
  toast,
  X,
} from "@repo/design-system";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/design-system/components/ui/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
import { formatDateTime, plural } from "../lib/format";
import { queryKeys } from "../lib/queries";
import { CopySecretButton, StoreDetailsForm } from "./store-details-form";
import {
  isWriteScope,
  STRATEGY_ICONS,
  STRATEGY_LABELS,
  type Store,
  usesOwnWebhookSecret,
} from "./store-labels";

const VISIBLE_SCOPES = 10;

export const ENVIRONMENT_OPTIONS = (["PROD", "STAGING", "DEV"] as const).map(
  (value) => ({ label: ENVIRONMENT_LABELS[value], value })
);

const Fact = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className="bg-card px-3.5 py-3">
    <div className="mb-2 text-muted-foreground text-xs leading-none">
      {label}
    </div>
    <div className="font-medium text-[13px] leading-[1.3]">{children}</div>
  </div>
);

const Section = ({
  aside,
  children,
  title,
}: {
  aside?: ReactNode;
  children: ReactNode;
  title: string;
}) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-center gap-2">
      <h3 className="flex-1 font-semibold text-sm leading-[1.2]">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

/** Starts a health check and says how it went. */
export const useHealthCheck = (organizationId: string | null) => {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState<string | null>(null);
  const check = async (store: Store) => {
    setChecking(store.id);
    try {
      const { data } = await apiClient.shopifyStores.checkHealth({
        storeId: store.id,
      });
      if (data.ok) {
        toast.success("Store is healthy", {
          description: `${store.name} · ${plural(data.store.scopes.length, "scope")} granted`,
        });
      } else {
        toast.error("Health check failed", {
          description: data.error ?? `${store.name} did not answer.`,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.stores(organizationId),
      });
    } catch (cause) {
      toast.error("Could not check the store", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setChecking(null);
    }
  };
  return { check, checking };
};

const WebhookSecret = ({
  canManage,
  onSaved,
  store,
}: {
  canManage: boolean;
  onSaved: () => void;
  store: Store;
}) => {
  const [secret, setSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await apiClient.shopifyStores.setWebhookSecret({
        secret,
        storeId: store.id,
      });
      setSecret("");
      toast.success("Webhook secret saved", {
        description: `Payloads from ${store.shopDomain} will now be verified.`,
      });
      onSaved();
    } catch (cause) {
      toast.error("Could not save the secret", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <Section
      aside={
        <span
          className={cn(
            "inline-flex items-center gap-[5px] font-medium text-xs",
            store.hasWebhookSecret
              ? "text-(--status-success-fg)"
              : "text-muted-foreground"
          )}
        >
          {store.hasWebhookSecret ? (
            <CircleCheck className="size-[13px]" />
          ) : (
            <CircleDashed className="size-[13px]" />
          )}
          {store.hasWebhookSecret ? "Secret set" : "Missing"}
          {canManage && store.hasWebhookSecret ? (
            <span className="ml-1.5">
              <CopySecretButton secret="webhookSecret" store={store} />
            </span>
          ) : null}
        </span>
      }
      title="Webhook secret"
    >
      <p className="text-[13px] text-muted-foreground leading-normal">
        Used to verify webhook payloads before a flow runs. Find it in the app's
        settings under <em>Webhooks</em>.
      </p>
      {canManage ? (
        <form className="flex items-start gap-2" onSubmit={save}>
          <div className="flex-1">
            <SecretInput
              aria-label="Webhook signing secret"
              helper={null}
              minLength={8}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={
                store.hasWebhookSecret
                  ? "•••••••• (saved — paste to replace)"
                  : "Paste webhook signing secret"
              }
              required
              value={secret}
            />
          </div>
          <Button disabled={isSaving || secret.length < 8} type="submit">
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : null}
      {canManage ? (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs leading-[1.4]">
          <ShieldCheck className="size-[13px]" />
          Stored encrypted. Copying it is recorded in the audit log.
        </p>
      ) : null}
    </Section>
  );
};

/** What disconnecting would affect, in one sentence. */
const describeImpact = (
  usage: { activationCount: number; flowCount: number } | undefined
) => {
  if (!usage) {
    return "Checking what uses this store…";
  }
  if (usage.flowCount === 0) {
    return "No flow has run on or is activated for this store.";
  }
  const one = usage.flowCount === 1;
  const activated =
    usage.activationCount > 0 ? `, ${usage.activationCount} activated` : "";
  return `${plural(usage.flowCount, "flow")} ${one ? "uses" : "use"} this store${activated}; ${one ? "it stops" : "they stop"} working until it's reconnected.`;
};

const DangerZone = ({
  onDisconnect,
  store,
}: {
  onDisconnect: () => void;
  store: Store;
}) => {
  const usage = useQuery({
    queryFn: async () =>
      (await apiClient.shopifyStores.usage({ storeId: store.id })).data,
    queryKey: ["store-usage", store.id],
  });
  const [confirming, setConfirming] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const impact = describeImpact(usage.data);

  const disconnect = async () => {
    setIsWorking(true);
    try {
      await apiClient.shopifyStores.disconnect({ storeId: store.id });
      toast.warning("Store disconnected", {
        description: `${store.name} credentials were removed.`,
      });
      setConfirming(false);
      onDisconnect();
    } catch (cause) {
      toast.error("Could not disconnect the store", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <section className="flex flex-col gap-2.5 rounded-menu border border-(--alert-danger-border) p-3.5">
      <h3 className="font-semibold text-(--status-danger-fg) text-sm leading-[1.2]">
        Disconnect store
      </h3>
      <p className="text-[13px] text-muted-foreground leading-normal">
        Removes the stored credentials. {impact}
      </p>
      <Button
        className="self-start"
        onClick={() => setConfirming(true)}
        size="sm"
        variant="destructive"
      >
        Disconnect {store.name}…
      </Button>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {store.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its credentials are removed and flows activated on it are turned
              off. Connect the same domain again to restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <div className="flex items-center gap-2.5 rounded-menu border border-border p-3">
              <IdentityChip id={store.id} name={store.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[13px]">
                  {store.name}
                </span>
                <span className="block truncate font-mono text-muted-foreground text-xs">
                  {store.shopDomain}
                </span>
              </span>
              <EnvTag environment={store.environment} />
            </div>
            <p className="text-[13px] text-muted-foreground">{impact}</p>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={isWorking} onClick={disconnect} variant="danger">
              {isWorking ? "Disconnecting…" : `Disconnect ${store.name}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

const EnvironmentSetting = ({
  onSaved,
  store,
}: {
  onSaved: () => void;
  store: Store;
}) => {
  const change = async (environment: Environment) => {
    try {
      await apiClient.shopifyStores.update({ environment, storeId: store.id });
      toast.success("Environment updated", {
        description: `${store.name} is now marked ${ENVIRONMENT_LABELS[environment].toLowerCase()}.`,
      });
      onSaved();
    } catch (cause) {
      toast.error("Could not change the environment", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    }
  };
  return (
    <Section title="Environment">
      <SegmentedControl
        aria-label="Environment"
        className="self-start"
        onValueChange={change}
        options={ENVIRONMENT_OPTIONS}
        value={store.environment}
      />
      <p className="text-muted-foreground text-xs leading-[1.4]">
        Production stores are marked in red, and writes to them ask first.
      </p>
    </Section>
  );
};

const DrawerHeader = ({
  onClose,
  store,
}: {
  onClose: () => void;
  store: Store;
}) => {
  const copyDomain = async () => {
    try {
      await navigator.clipboard.writeText(store.shopDomain);
      toast.success("Copied", { description: store.shopDomain });
    } catch {
      toast.error("Could not copy", { description: store.shopDomain });
    }
  };
  return (
    <div className="flex items-start gap-3 border-border border-b px-5 pt-[18px] pb-4">
      <IdentityChip
        className="rounded-[9px]!"
        id={store.id}
        name={store.name}
        size={38}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <SheetTitle className="truncate font-semibold text-[17px] leading-[1.25] tracking-[-0.01em]">
            {store.name}
          </SheetTitle>
          <EnvTag environment={store.environment} />
        </div>
        <SheetDescription className="flex items-center gap-1.5 font-mono text-[12.5px] text-muted-foreground leading-[1.4]">
          {store.shopDomain}
          <Button
            aria-label="Copy domain"
            className="size-5 text-muted-foreground"
            onClick={copyDomain}
            size="icon-xs"
            variant="ghost"
          >
            <Copy className="size-[13px]" />
          </Button>
          <a
            aria-label="Open the store's admin"
            className="text-muted-foreground hover:text-foreground"
            href={`https://${store.shopDomain}/admin`}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-[13px]" />
          </a>
        </SheetDescription>
      </div>
      <Button
        aria-label="Close"
        className="text-muted-foreground"
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <X className="size-[17px]" />
      </Button>
    </div>
  );
};

const ReconnectAlert = ({
  canManage,
  store,
}: {
  canManage: boolean;
  store: Store;
}) => {
  if (store.status !== "RECONNECT_REQUIRED") {
    return null;
  }
  return (
    <InlineAlert icon={<KeyRound />} title="Reconnect required." tone="warning">
      {store.lastHealthCheckError ?? "Shopify refused the store's credentials."}{" "}
      Flows targeting this store will fail until it's reconnected.
      {canManage ? (
        <div className="mt-2.5">
          <Link
            className={cn(
              buttonVariants({ size: "sm" }),
              "border-[#6a490c] bg-[#6a490c] hover:bg-[#6a490c]/90"
            )}
            href={`/stores/new?shop=${encodeURIComponent(store.shopDomain)}`}
          >
            Reconnect
          </Link>
        </div>
      ) : null}
    </InlineAlert>
  );
};

const ScopesSection = ({ store }: { store: Store }) => {
  const [allScopes, setAllScopes] = useState(false);
  const scopes = allScopes
    ? store.scopes
    : store.scopes.slice(0, VISIBLE_SCOPES);
  return (
    <Section
      aside={
        <span className="font-medium font-mono text-muted-foreground text-xs">
          {store.scopes.length} granted
        </span>
      }
      title="Access scopes"
    >
      <div className="flex flex-wrap gap-[5px]">
        {scopes.map((scope) => (
          <span
            className={cn(
              "rounded border px-[7px] py-[5px] font-medium font-mono text-[11.5px] leading-none",
              isWriteScope(scope)
                ? "border-[oklch(0.9_0.05_60)] bg-[oklch(0.96_0.03_60)] text-[oklch(0.42_0.1_55)]"
                : "border-border bg-sunken text-foreground-2"
            )}
            key={scope}
          >
            {scope}
          </span>
        ))}
        {store.scopes.length > VISIBLE_SCOPES ? (
          <Button
            className="h-auto rounded border-dashed px-2 py-[5px] font-medium text-[11.5px] text-accent-ink"
            onClick={() => setAllScopes((current) => !current)}
            variant="outline"
          >
            {allScopes
              ? "Show less"
              : `+${store.scopes.length - VISIBLE_SCOPES} more`}
          </Button>
        ) : null}
        {store.scopes.length === 0 ? (
          <span className="text-muted-foreground text-xs">None recorded.</span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs leading-[1.4]">
        Write scopes are highlighted. Scopes are set by the app or custom-app
        token and can't be changed here.
      </p>
    </Section>
  );
};

/**
 * A store's health, editable details, scopes, webhook secret and danger zone,
 * in a right sheet.
 */
export function StoreDrawer({
  canManage,
  checking,
  onCheck,
  onClose,
  onRefresh,
  store,
}: {
  canManage: boolean;
  checking: boolean;
  onCheck: () => void;
  onClose: () => void;
  onRefresh: () => void;
  store: Store | null;
}) {
  return (
    <Sheet
      onOpenChange={(open) => (open ? null : onClose())}
      open={store !== null}
    >
      <SheetContent
        className="w-[min(500px,calc(100vw-16px))] gap-0 p-0 sm:max-w-none"
        showCloseButton={false}
        side="right"
      >
        {store ? (
          <>
            <DrawerHeader onClose={onClose} store={store} />
            <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-5 pt-[18px] pb-6">
              <ReconnectAlert canManage={canManage} store={store} />
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-menu border border-border bg-border">
                <Fact label="Status">
                  <StatusBadge status={store.status} />
                </Fact>
                <Fact label="Last health check">
                  {store.lastHealthCheckAt
                    ? formatDateTime(store.lastHealthCheckAt)
                    : "Not run yet"}
                </Fact>
                <Fact label="Connection">
                  <span className="flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
                    {STRATEGY_ICONS[store.strategy]}
                    {STRATEGY_LABELS[store.strategy]}
                  </span>
                </Fact>
                <Fact label="API version">
                  <span className="font-mono">{store.apiVersion}</span>
                </Fact>
              </div>
              <Button
                className="self-start"
                disabled={checking}
                onClick={onCheck}
                size="sm"
                variant="outline"
              >
                {checking ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Activity />
                )}
                {checking ? "Checking…" : "Check health now"}
              </Button>
              {canManage ? (
                <StoreDetailsForm onSaved={onRefresh} store={store} />
              ) : null}
              {canManage ? (
                <EnvironmentSetting onSaved={onRefresh} store={store} />
              ) : null}
              <ScopesSection store={store} />
              {usesOwnWebhookSecret(store) ? (
                <WebhookSecret
                  canManage={canManage}
                  onSaved={onRefresh}
                  store={store}
                />
              ) : null}
              {canManage && store.status !== "DISCONNECTED" ? (
                <DangerZone onDisconnect={onRefresh} store={store} />
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
