"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Box,
  Button,
  buttonVariants,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  cn,
  type Environment,
  ErrorAlert,
  ExternalLink,
  Info,
  KeyRound,
  LoaderCircle,
  SecretInput,
  SectionLabel,
  SegmentedControl,
  ShieldCheck,
  toast,
} from "@repo/design-system";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/design-system/components/ui/input-group";
import {
  RadioGroup,
  RadioGroupItem,
} from "@repo/design-system/components/ui/radio-group";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useActiveOrganization } from "../../lib/active-organization";
import { OptionSelect } from "../../lib/option-select";
import { useShopifyApps } from "../../lib/queries";
import { ENVIRONMENT_OPTIONS } from "../store-drawer";
import type { ShopifyApp } from "../store-labels";

type Method = "token" | "creds" | "oauth";

type OAuthStart = Awaited<
  ReturnType<typeof apiClient.shopifyStores.beginOAuth>
>["data"];

interface ConnectResult {
  error: string | null;
  ok: boolean;
  shopDomain: string;
  store: { scopes: string[] } | null;
}

/** The API accepts ten domains per request; longer lists go in chunks. */
const DOMAINS_PER_REQUEST = 10;
const DOMAIN_SEPARATOR = /[\s,]+/;
const SHOPIFY_SUFFIX = ".myshopify.com";

/** "your-store" or "your-store.myshopify.com" both mean the same store. */
const toShopDomain = (value: string) => {
  const domain = value.trim().toLowerCase();
  return !domain || domain.includes(".")
    ? domain
    : `${domain}${SHOPIFY_SUFFIX}`;
};

const METHODS: {
  best: string;
  icon: ReactNode;
  iconClass: string;
  name: string;
  time: string;
  value: Method;
}[] = [
  {
    best: "You created a custom app in the store's own admin and have its Admin API token.",
    icon: <KeyRound />,
    iconClass: "bg-[oklch(0.94_0.04_60)] text-[oklch(0.45_0.1_55)]",
    name: "Access token",
    time: "About 1 minute",
    value: "token",
  },
  {
    best: "The store is in the same Shopify organization as one of your registered apps.",
    icon: <Box />,
    iconClass: "bg-[oklch(0.94_0.035_250)] text-[oklch(0.42_0.12_255)]",
    name: "App credentials",
    time: "Bulk · seconds per store",
    value: "creds",
  },
  {
    best: "Any other store. The store owner approves the install in Shopify.",
    icon: <ShieldCheck />,
    iconClass: "bg-[oklch(0.94_0.04_160)] text-[oklch(0.4_0.09_165)]",
    name: "OAuth install",
    time: "Needs owner approval",
    value: "oauth",
  },
];

const GUIDE: { answer: string; method: Method; situation: string }[] = [
  {
    answer: "Access token",
    method: "token",
    situation: "I created a custom app inside the store's admin.",
  },
  {
    answer: "App credentials",
    method: "creds",
    situation: "The store belongs to the same Shopify organization as our app.",
  },
  {
    answer: "OAuth install",
    method: "oauth",
    situation: "It's a client's or partner's store we don't own.",
  },
];

const DomainInput = ({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) => (
  <Field className="gap-1.5">
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <InputGroup className="overflow-hidden bg-card">
      <InputGroupInput
        aria-label={label}
        autoComplete="off"
        className="font-mono text-[13.5px]"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder="your-store"
        required
        spellCheck={false}
        value={value}
      />
      <InputGroupAddon
        align="inline-end"
        className="h-full self-stretch rounded-none border-input border-l bg-sunken px-2.5 font-mono text-[13px] text-muted-foreground"
      >
        {SHOPIFY_SUFFIX}
      </InputGroupAddon>
    </InputGroup>
  </Field>
);

const EnvironmentField = ({
  onChange,
  value,
}: {
  onChange: (environment: Environment) => void;
  value: Environment;
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="font-medium text-[13px]">Environment</span>
    <SegmentedControl
      aria-label="Environment"
      className="self-start"
      onValueChange={onChange}
      options={ENVIRONMENT_OPTIONS}
      value={value}
    />
    <span className="text-muted-foreground text-xs leading-[1.4]">
      Production stores are marked in red, and writes to them ask first.
    </span>
  </div>
);

const AppPicker = ({
  appId,
  apps,
  onChange,
}: {
  appId: string;
  apps: ShopifyApp[];
  onChange: (appId: string) => void;
}) =>
  apps.length === 0 ? (
    <p className="text-muted-foreground text-sm">
      No Shopify app is registered yet.{" "}
      <Link
        className="font-medium text-accent-ink hover:underline"
        href="/stores/apps"
      >
        Register an app
      </Link>{" "}
      first.
    </p>
  ) : (
    <Field className="gap-1.5">
      <FieldLabel>App</FieldLabel>
      <OptionSelect
        aria-label="Shopify app"
        onValueChange={onChange}
        options={apps.map((app) => ({
          label: `${app.name} · ${app.tokenMode === "EXPIRING" ? "Expiring tokens" : app.clientId.slice(0, 4)}`,
          value: app.id,
        }))}
        placeholder="Choose an app"
        value={appId || null}
      />
    </Field>
  );

const MethodCards = ({
  method,
  onChange,
}: {
  method: Method;
  onChange: (method: Method) => void;
}) => (
  <RadioGroup
    aria-label="Connection method"
    className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5"
    onValueChange={(value) => onChange(value as Method)}
    value={method}
  >
    {METHODS.map((option) => {
      const selected = option.value === method;
      return (
        <label
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-[9px] border bg-card p-3.5 transition-shadow",
            selected
              ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]"
              : "border-border hover:border-input"
          )}
          htmlFor={`method-${option.value}`}
          key={option.value}
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 place-items-center rounded-[7px] [&_svg]:size-[15px]",
                option.iconClass
              )}
            >
              {option.icon}
            </span>
            <span className="flex-1 font-semibold text-sm leading-[1.2]">
              {option.name}
            </span>
            <RadioGroupItem
              id={`method-${option.value}`}
              value={option.value}
            />
          </span>
          <span className="text-[12.5px] text-muted-foreground leading-[1.45]">
            {option.best}
          </span>
          <span className="flex items-center gap-[5px] font-medium text-[11.5px] text-foreground-2 leading-[1.3]">
            <Clock className="size-3 text-muted-foreground" />
            {option.time}
          </span>
        </label>
      );
    })}
  </RadioGroup>
);

const MethodGuide = ({
  method,
  onPick,
}: {
  method: Method;
  onPick: (method: Method) => void;
}) => (
  <aside className="sticky top-5 flex flex-col gap-3 rounded-card border border-border bg-sunken p-4">
    <h2 className="flex items-center gap-2 font-semibold text-sm leading-[1.2]">
      <Info className="size-4 text-muted-foreground" />
      Which method?
    </h2>
    <p className="text-[12.5px] text-muted-foreground leading-[1.45]">
      Pick the sentence that matches your situation.
    </p>
    {GUIDE.map((entry) => (
      <Button
        aria-pressed={entry.method === method}
        className={cn(
          "h-auto flex-col items-start gap-1.5 whitespace-normal rounded-menu bg-card px-3 py-[11px] text-left font-normal hover:bg-card",
          entry.method === method
            ? "border-accent"
            : "border-border hover:border-input"
        )}
        key={entry.method}
        onClick={() => onPick(entry.method)}
        variant="outline"
      >
        <span className="text-[13px] leading-[1.45]">{entry.situation}</span>
        <span className="font-semibold text-accent-ink text-xs leading-none">
          → {entry.answer}
        </span>
      </Button>
    ))}
  </aside>
);

const ResultList = ({ results }: { results: ConnectResult[] }) => (
  <ul className="overflow-hidden rounded-menu border border-border">
    {results.map((result) => (
      <li
        className="flex items-center gap-2.5 border-border border-b px-3 py-2.5 last:border-b-0"
        key={result.shopDomain}
      >
        {result.ok ? (
          <CircleCheck className="size-[15px] text-(--status-success-dot)" />
        ) : (
          <CircleX className="size-[15px] text-(--status-danger-dot)" />
        )}
        <span className="flex-1 font-mono text-[13px]">
          {result.shopDomain}
        </span>
        <span className="text-[12.5px] text-muted-foreground leading-[1.3]">
          {result.ok
            ? `Connected · ${result.store?.scopes.length ?? 0} scopes`
            : result.error}
        </span>
      </li>
    ))}
  </ul>
);

/** Shared submit state of the three forms: busy flag and the last error. */
const useConnect = (organizationId: string) => {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const run =
    (action: (organizationId: string) => Promise<void>) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
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
  return { error, isSubmitting, run };
};

const FormIntro = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <div>
    <h2 className="font-semibold text-[15px] leading-[1.3]">{title}</h2>
    <p className="mt-0.5 text-[13px] text-muted-foreground leading-normal">
      {children}
    </p>
  </div>
);

interface MethodFormProps {
  appId: string;
  apps: ShopifyApp[];
  environment: Environment;
  initialShop: string;
  onAppChange: (appId: string) => void;
  onEnvironmentChange: (environment: Environment) => void;
  organizationId: string;
}

const TokenForm = ({
  environment,
  initialShop,
  onEnvironmentChange,
  organizationId,
}: MethodFormProps) => {
  const router = useRouter();
  const [shopDomain, setShopDomain] = useState(initialShop);
  const [accessToken, setAccessToken] = useState("");
  const { error, isSubmitting, run } = useConnect(organizationId);
  const submit = run(async (id) => {
    const { data } = await apiClient.shopifyStores.connectStaticToken({
      accessToken,
      environment,
      organizationId: id,
      shopDomain: toShopDomain(shopDomain),
    });
    toast.success("Store connected", {
      description: `Token verified · ${data.scopes.length} scopes granted`,
    });
    router.push("/stores");
  });
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <FormIntro title="Paste an Admin API access token">
        From a custom app created in the store's own admin:{" "}
        <span className="font-mono text-xs">
          Settings → Apps → Develop apps
        </span>
        .
      </FormIntro>
      {error ? (
        <ErrorAlert message={error} title="Couldn't connect the store." />
      ) : null}
      <DomainInput
        id="token-shop-domain"
        label="Shop domain"
        onChange={setShopDomain}
        value={shopDomain}
      />
      <Field className="gap-1.5">
        <FieldLabel htmlFor="admin-api-token">
          Admin API access token
        </FieldLabel>
        <SecretInput
          helper="Checked against Shopify before the store is saved. Stored encrypted and never shown again."
          id="admin-api-token"
          onChange={(event) => setAccessToken(event.target.value)}
          placeholder="shpat_…"
          required
          value={accessToken}
        />
      </Field>
      <EnvironmentField onChange={onEnvironmentChange} value={environment} />
      <div className="flex items-center gap-2">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
          {isSubmitting ? "Verifying with Shopify…" : "Connect store"}
        </Button>
        <Link className={buttonVariants({ variant: "ghost" })} href="/stores">
          Cancel
        </Link>
      </div>
    </form>
  );
};

const CredentialsForm = ({
  appId,
  apps,
  environment,
  initialShop,
  onAppChange,
  onEnvironmentChange,
  organizationId,
}: MethodFormProps) => {
  const [domainList, setDomainList] = useState(initialShop);
  const [results, setResults] = useState<ConnectResult[]>([]);
  const { error, isSubmitting, run } = useConnect(organizationId);
  const domains = [
    ...new Set(
      domainList.split(DOMAIN_SEPARATOR).map(toShopDomain).filter(Boolean)
    ),
  ];
  const submit = run(async (id) => {
    setResults([]);
    for (let start = 0; start < domains.length; start += DOMAINS_PER_REQUEST) {
      const { data } = await apiClient.shopifyStores.connectClientCredentials({
        appId,
        environment,
        organizationId: id,
        shopDomains: domains.slice(start, start + DOMAINS_PER_REQUEST),
      });
      setResults((current) => [...current, ...data]);
    }
  });
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <FormIntro title="Connect with app credentials">
        Works for stores in the same Shopify organization as the app. Connect
        several at once.
      </FormIntro>
      {error ? (
        <ErrorAlert message={error} title="Couldn't connect the stores." />
      ) : null}
      <AppPicker appId={appId} apps={apps} onChange={onAppChange} />
      <Field className="gap-1.5">
        <FieldLabel htmlFor="shop-domains">
          Store domains{" "}
          <span className="font-normal text-muted-foreground">
            · one per line
          </span>
        </FieldLabel>
        <Textarea
          aria-label="Shop domains"
          className="font-mono text-[13px] leading-[1.6]"
          id="shop-domains"
          onChange={(event) => setDomainList(event.target.value)}
          placeholder={"store-one.myshopify.com\nstore-two.myshopify.com"}
          required
          rows={4}
          value={domainList}
        />
      </Field>
      <EnvironmentField onChange={onEnvironmentChange} value={environment} />
      <Button
        className="self-start"
        disabled={isSubmitting || !appId}
        type="submit"
      >
        {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
        {isSubmitting
          ? "Connecting…"
          : `Connect ${domains.length === 1 ? "1 store" : `${domains.length || ""} stores`.trim()}`}
      </Button>
      {results.length > 0 ? <ResultList results={results} /> : null}
    </form>
  );
};

const OAuthForm = ({
  appId,
  apps,
  environment,
  initialShop,
  onAppChange,
  onEnvironmentChange,
  organizationId,
}: MethodFormProps) => {
  const [shopDomain, setShopDomain] = useState(initialShop);
  const [oauthStart, setOauthStart] = useState<OAuthStart | null>(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const { error, isSubmitting, run } = useConnect(organizationId);
  useEffect(() => {
    setRedirectUrl(`${window.location.origin}/api/shopify/oauth/callback`);
  }, []);
  const submit = run(async (id) => {
    const { data } = await apiClient.shopifyStores.beginOAuth({
      appId,
      environment,
      organizationId: id,
      shopDomain: toShopDomain(shopDomain),
    });
    setOauthStart(data);
  });
  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUrl);
      toast.success("Redirect URL copied", {
        description: "Paste it into the app's allowed redirection URLs.",
      });
    } catch {
      toast.error("Could not copy", { description: redirectUrl });
    }
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <FormIntro title="Install through OAuth">
        For any other store — a store owner approves the install in Shopify,
        then returns here.
      </FormIntro>
      {error ? (
        <ErrorAlert message={error} title="Couldn't start the install." />
      ) : null}
      <div className="flex gap-2.5 rounded-menu border border-border bg-sunken px-3.5 py-3">
        <Info className="mt-0.5 size-[15px] shrink-0 text-accent-ink" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[13px] leading-normal">
            Add this redirect URL to the app's{" "}
            <strong className="font-semibold">
              Allowed redirection URL(s)
            </strong>{" "}
            in the Shopify Dev Dashboard first.
          </p>
          <div className="flex gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-input bg-card px-2.5 font-mono text-[12.5px] leading-8">
              {redirectUrl}
            </code>
            <Button onClick={copyRedirect} type="button" variant="outline">
              <Copy className="size-[13px]" />
              Copy
            </Button>
          </div>
        </div>
      </div>
      <AppPicker appId={appId} apps={apps} onChange={onAppChange} />
      <DomainInput
        id="oauth-shop-domain"
        label="Shop domain for OAuth"
        onChange={setShopDomain}
        value={shopDomain}
      />
      <EnvironmentField onChange={onEnvironmentChange} value={environment} />
      {oauthStart ? (
        <div className="flex flex-col gap-2.5 rounded-menu border border-border p-3.5 text-sm">
          <p>
            {oauthStart.store.shopDomain} is waiting for the install. The link
            is valid for 10 minutes and works once.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className={buttonVariants()} href={oauthStart.authorizeUrl}>
              Continue to Shopify
              <ExternalLink />
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
      ) : (
        <Button
          className="self-start"
          disabled={isSubmitting || !appId}
          type="submit"
        >
          {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
          {isSubmitting ? "Preparing…" : "Continue to Shopify"}
          {isSubmitting ? null : <ExternalLink />}
        </Button>
      )}
      <FieldDescription className="text-xs">
        You must stay signed in to wizdek in this browser until Shopify sends
        you back.
      </FieldDescription>
    </form>
  );
};

const FORMS = {
  creds: CredentialsForm,
  oauth: OAuthForm,
  token: TokenForm,
} as const;

export function ConnectStoreForm() {
  const searchParams = useSearchParams();
  const { organization } = useActiveOrganization();
  const organizationId = organization?.id ?? null;
  const apps = useShopifyApps(organizationId);
  const [method, setMethod] = useState<Method>("token");
  const [appId, setAppId] = useState("");
  const [environment, setEnvironment] = useState<Environment>("DEV");
  const appList = apps.data ?? [];
  const firstAppId = appList[0]?.id;

  useEffect(() => {
    if (!appId && firstAppId) {
      setAppId(firstAppId);
    }
  }, [appId, firstAppId]);

  const MethodForm = FORMS[method];

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-5">
        <SectionLabel>1 · Method</SectionLabel>
        <MethodCards method={method} onChange={setMethod} />
        <SectionLabel className="mt-1.5">2 · Details</SectionLabel>
        <div className="flex flex-col gap-4 rounded-card border border-border p-5">
          {organizationId ? (
            <MethodForm
              appId={appId}
              apps={appList}
              environment={environment}
              initialShop={searchParams.get("shop") ?? ""}
              onAppChange={setAppId}
              onEnvironmentChange={setEnvironment}
              organizationId={organizationId}
            />
          ) : null}
        </div>
      </div>
      <MethodGuide method={method} onPick={setMethod} />
    </div>
  );
}
