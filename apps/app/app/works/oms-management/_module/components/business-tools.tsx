"use client";
import { Button, LoaderCircle } from "@repo/design-system";
import {
  Alert,
  AlertAction,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PublicProfile } from "../lib/contracts";
import { AccountSelect } from "./account-select";
import { request } from "./management-app";
import { ChoiceSelect, ErrorNotice, Panel, TextField } from "./oms-ui";
import { OperationButton, OperationHistory } from "./operation-controls";

type Row = Record<string, unknown>;
type ToolTab = "stores" | "fraud" | "documents";

const TOOL_TABS: [ToolTab, string][] = [
  ["stores", "Store credentials"],
  ["fraud", "Fraud review"],
  ["documents", "Original files"],
];
const CONTENT_DISPOSITION_FILENAME = /filename="([^"]+)"/;

export function BusinessTools({
  profile,
  setDirty,
}: {
  profile: PublicProfile;
  setDirty: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<ToolTab>("stores");
  const [selected, setSelected] = useState("");
  const [account, setAccount] = useState("");
  const [orderId, setOrderId] = useState("");
  const [risk, setRisk] = useState("LOW");
  const [signature, setSignature] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const catalog = useQuery({
    queryFn: ({ signal }) =>
      request<{
        data: {
          shopify: { apps: Row[]; stores: Row[]; settings: Row[] };
          jobs: Row[];
        };
      }>(
        "bridge?" +
          new URLSearchParams({
            profileId: profile.id,
            revision: String(profile.revision),
          }),
        { signal }
      ),
    queryKey: ["oms", profile.id, profile.revision, "bridge-catalog"],
  });
  useEffect(() => {
    if (secret === null) {
      return;
    }
    const timer = setTimeout(() => setSecret(null), 15_000);
    return () => clearTimeout(timer);
  }, [secret]);
  const store = catalog.data?.data.shopify.stores.find(
    (row) => row.id === selected
  );
  async function reveal(action: string) {
    setError("");
    setSecret(null);
    try {
      const result = await request<{ secret: string | null }>("bridge", {
        body: JSON.stringify({
          accountId: store?.accountId,
          action,
          payload: { storeId: selected },
          profileId: profile.id,
          revision: profile.revision,
        }),
        method: "POST",
      });
      setSecret(result.secret ?? "No secret stored.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {profile.hasApi ? null : (
        <Alert>
          <AlertDescription>
            Add the OMS API in Connection settings to execute business commands.
            Credentials and documents use the selected database and storage.
          </AlertDescription>
        </Alert>
      )}
      <Tabs
        onValueChange={(value) => {
          setSecret(null);
          setTab(value as ToolTab);
        }}
        value={tab}
      >
        <TabsList className="max-w-full overflow-x-auto" variant="line">
          {TOOL_TABS.map(([id, label]) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {catalog.error ? <ErrorNotice message={catalog.error.message} /> : null}
        <TabsContent value="stores">
          <Panel
            description="Secrets are revealed only after an explicit audited request, and hidden again after 15 seconds."
            title="Store credentials"
          >
            <div className="flex flex-col gap-4">
              <ChoiceSelect
                choices={(catalog.data?.data.shopify.stores ?? []).map(
                  (row) => ({
                    label: `${String(row.name)} · ${String(row.shopDomain)}`,
                    value: String(row.id),
                  })
                )}
                id="store-credential"
                label="Store"
                onValueChange={(value) => {
                  setSecret(null);
                  setSelected(value);
                }}
                placeholder="Select store"
                value={selected}
              />
              {store ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        !profile.capabilities.includes("secrets:reveal")
                      }
                      onClick={() => reveal("shopify.token.reveal")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Reveal access token
                    </Button>
                    <Button
                      disabled={
                        !profile.capabilities.includes("secrets:reveal")
                      }
                      onClick={() => reveal("shopify.signature.reveal")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Reveal webhook signature
                    </Button>
                  </div>
                  {secret !== null && (
                    <Alert>
                      <AlertDescription>
                        <code className="break-all font-mono text-xs">
                          {secret}
                        </code>
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          onClick={() => setSecret(null)}
                          size="xs"
                          type="button"
                          variant="ghost"
                        >
                          Hide now
                        </Button>
                      </AlertAction>
                    </Alert>
                  )}
                  <TextField
                    autoComplete="new-password"
                    description="Empty value clears the signature after confirmation."
                    id="webhook-signature"
                    label="Replace webhook signature"
                    onChange={(e) => {
                      setSignature(e.target.value);
                      setDirty(true);
                    }}
                    type="password"
                    value={signature}
                  />
                  <OperationButton
                    accountId={String(store.accountId)}
                    action="shopify.signature.update"
                    expectedVersion={String(store.updatedAt)}
                    label="Review signature change"
                    onComplete={() => {
                      setSignature("");
                      setDirty(false);
                    }}
                    payload={{ signature, storeId: selected }}
                    profile={profile}
                  />
                </>
              ) : null}
              {error ? <ErrorNotice message={error} /> : null}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="fraud">
          <Panel
            description="Only orders currently in Fraud Check can be reviewed. The preview shows the current record before confirmation."
            title="Review fraud risk"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <AccountSelect
                id="fraud-account"
                onValueChange={setAccount}
                profile={profile}
                value={account}
              />
              <TextField
                id="fraud-order"
                label="OMS order ID"
                onChange={(e) => setOrderId(e.target.value)}
                value={orderId}
              />
              <ChoiceSelect
                choices={["LOW", "MEDIUM", "HIGH"].map((value) => ({
                  label: value,
                  value,
                }))}
                id="fraud-risk"
                label="Reviewed risk"
                onValueChange={setRisk}
                value={risk}
              />
            </div>
            <OperationButton
              accountId={account}
              action="fraud.review"
              expectedVersion={null}
              label="Preview fraud review"
              payload={{ orderId, riskLevel: risk }}
              profile={profile}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="documents">
          <DocumentTools profile={profile} />
        </TabsContent>
      </Tabs>
      <OperationHistory profile={profile} />
    </div>
  );
}
function DocumentTools({ profile }: { profile: PublicProfile }) {
  const [account, setAccount] = useState("");
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/works/oms-management/api/bridge", {
        body: JSON.stringify({
          accountId: account,
          action: "download.original",
          payload: { id },
          profileId: profile.id,
          revision: profile.revision,
        }),
        headers: { "content-type": "application/json", "x-oms-action": "1" },
        method: "POST",
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? "Download failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("content-disposition")
          ?.match(CONTENT_DISPOSITION_FILENAME)?.[1] ?? "oms-document";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      description="Downloads use the selected database and storage and are recorded in the management audit log."
      title="Retrieve original import file"
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <AccountSelect
            id="document-account"
            onValueChange={setAccount}
            profile={profile}
            value={account}
          />
          <TextField
            id="document-id"
            label="Workflow run ID"
            onChange={(event) => setId(event.target.value)}
            value={id}
          />
        </div>
        <Button
          disabled={busy || !account || !id}
          onClick={download}
          size="sm"
          type="button"
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          {busy ? "Retrieving…" : "Download original"}
        </Button>
        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </Panel>
  );
}
