"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  Copy,
  Input,
  LoaderCircle,
  RotateCcw,
  SecretInput,
  toast,
} from "@repo/design-system";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import { type FormEvent, useEffect, useState } from "react";
import type { Store } from "./store-labels";

type StoreSecret = "accessToken" | "webhookSecret";

const SECRET_LABELS: Record<StoreSecret, string> = {
  accessToken: "Access token",
  webhookSecret: "Webhook secret",
};

const fetchSecret = async (store: Store, secret: StoreSecret) =>
  (await apiClient.shopifyStores.revealSecret({ secret, storeId: store.id }))
    .data.value;

/**
 * Writes the secret to the clipboard without ever rendering it. The clipboard
 * item is created during the click, so browsers that need a user gesture
 * (Safari) still accept a value that arrives later.
 */
const writeSecretToClipboard = async (store: Store, secret: StoreSecret) => {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    const blob = fetchSecret(store, secret).then(
      (value) => new Blob([value], { type: "text/plain" })
    );
    await navigator.clipboard.write([
      new ClipboardItem({ "text/plain": blob }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(await fetchSecret(store, secret));
};

/** Copies a store's access token or webhook secret; each copy is audited. */
export const CopySecretButton = ({
  secret,
  store,
}: {
  secret: StoreSecret;
  store: Store;
}) => {
  const [copying, setCopying] = useState(false);
  const label = SECRET_LABELS[secret];
  const copy = async () => {
    setCopying(true);
    try {
      await writeSecretToClipboard(store, secret);
      toast.success(`${label} copied`, {
        description: "The copy was recorded in the audit log.",
      });
    } catch (cause) {
      toast.error(`Could not copy the ${label.toLowerCase()}`, {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setCopying(false);
    }
  };
  return (
    <Button
      aria-label={`Copy ${label.toLowerCase()}`}
      disabled={copying}
      onClick={copy}
      size="sm"
      type="button"
      variant="outline"
    >
      {copying ? <LoaderCircle className="animate-spin" /> : <Copy />}
      Copy
    </Button>
  );
};

const NameField = ({
  onSaved,
  store,
}: {
  onSaved: () => void;
  store: Store;
}) => {
  const [name, setName] = useState(store.name);
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(store.name), [store.name]);

  const save = async (next: string | null) => {
    setSaving(true);
    try {
      await apiClient.shopifyStores.update({ name: next, storeId: store.id });
      toast.success(next === null ? "Using the Shopify name" : "Store renamed");
      onSaved();
    } catch (cause) {
      toast.error("Could not rename the store", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setSaving(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save(name.trim());
  };
  const unchanged = name.trim() === store.name || name.trim() === "";

  return (
    <form onSubmit={submit}>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="store-name">Store name</FieldLabel>
        <div className="flex items-start gap-2">
          <Input
            autoComplete="off"
            className="flex-1"
            id="store-name"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <Button
            aria-label="Save store name"
            disabled={saving || unchanged}
            type="submit"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        <FieldDescription className="flex items-center gap-1.5 text-xs">
          {store.nameCustomized
            ? "Your name is kept when the store is checked."
            : "Taken from Shopify on each health check until you rename it."}
          {store.nameCustomized ? (
            <Button
              className="h-auto p-0 text-xs"
              disabled={saving}
              onClick={() => save(null)}
              type="button"
              variant="link"
            >
              <RotateCcw className="size-3" />
              Use the Shopify name
            </Button>
          ) : null}
        </FieldDescription>
      </Field>
    </form>
  );
};

/** Domain and token of a store connected by a pasted token, checked on save. */
const TokenCredentials = ({
  onSaved,
  store,
}: {
  onSaved: () => void;
  store: Store;
}) => {
  const [shopDomain, setShopDomain] = useState(store.shopDomain);
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setShopDomain(store.shopDomain), [store.shopDomain]);

  const domain = shopDomain.trim().toLowerCase();
  const domainChanged = domain !== "" && domain !== store.shopDomain;
  const tokenEntered = accessToken.trim().length >= 8;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.shopifyStores.updateCredentials({
        ...(tokenEntered ? { accessToken: accessToken.trim() } : {}),
        ...(domainChanged ? { shopDomain: domain } : {}),
        storeId: store.id,
      });
      setAccessToken("");
      toast.success("Credentials saved", {
        description: `Shopify accepted them for ${domain}.`,
      });
      onSaved();
    } catch (cause) {
      toast.error("Could not save the credentials", {
        description: getApiErrorMessage(cause, "Nothing was changed."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="store-domain">Store domain</FieldLabel>
        <Input
          autoComplete="off"
          className="font-mono text-[13px]"
          id="store-domain"
          onChange={(event) => setShopDomain(event.target.value)}
          placeholder="your-store.myshopify.com"
          spellCheck={false}
          value={shopDomain}
        />
      </Field>
      <Field className="gap-1.5">
        <div className="flex items-center gap-2">
          <FieldLabel className="flex-1" htmlFor="store-token">
            Access token
          </FieldLabel>
          {store.status === "DISCONNECTED" ? null : (
            <CopySecretButton secret="accessToken" store={store} />
          )}
        </div>
        <SecretInput
          helper="Leave empty to keep the current token. Shopify checks the domain and token before anything is saved."
          helperId="store-token-helper"
          id="store-token"
          onChange={(event) => setAccessToken(event.target.value)}
          placeholder="•••••••• (saved — paste to replace)"
          value={accessToken}
        />
      </Field>
      <Button
        className="self-start"
        disabled={saving || !(domainChanged || tokenEntered)}
        type="submit"
      >
        {saving ? "Checking with Shopify…" : "Save and verify"}
      </Button>
    </form>
  );
};

/** Read-only domain for stores whose token the toolkit obtains itself. */
const ManagedCredentials = ({ store }: { store: Store }) => (
  <div className="flex flex-col gap-3">
    <Field className="gap-1.5">
      <FieldLabel htmlFor="store-domain">Store domain</FieldLabel>
      <Input
        className="font-mono text-[13px]"
        id="store-domain"
        readOnly
        value={store.shopDomain}
      />
    </Field>
    <Field className="gap-1.5">
      <div className="flex items-center gap-2">
        <FieldLabel className="flex-1">Access token</FieldLabel>
        {store.status === "DISCONNECTED" ? null : (
          <CopySecretButton secret="accessToken" store={store} />
        )}
      </div>
      <FieldDescription className="text-xs">
        Issued and renewed by the toolkit through the app. To change the domain
        or token, reconnect the store.
      </FieldDescription>
    </Field>
  </div>
);

/** The editable name, domain and access token of a store. */
export const StoreDetailsForm = ({
  onSaved,
  store,
}: {
  onSaved: () => void;
  store: Store;
}) => (
  <section className="flex flex-col gap-3.5">
    <h3 className="font-semibold text-sm leading-[1.2]">Details</h3>
    <NameField onSaved={onSaved} store={store} />
    {store.strategy === "STATIC_TOKEN" ? (
      <TokenCredentials onSaved={onSaved} store={store} />
    ) : (
      <ManagedCredentials store={store} />
    )}
  </section>
);
