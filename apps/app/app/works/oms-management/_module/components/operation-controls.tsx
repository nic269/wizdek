"use client";
import { Button, Input, LoaderCircle } from "@repo/design-system";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/design-system/components/ui/alert";
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
import { Switch } from "@repo/design-system/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PublicProfile } from "../lib/contracts";
import { request } from "./management-app";
import { ErrorNotice, FormField, Panel } from "./oms-ui";

interface Preview {
  action: string;
  after: unknown;
  before: unknown;
  confirmation: string;
  expiresAt: string;
  operationId: string;
  target: { name: string; safetyClass: string; revision: number };
}
export function OperationButton({
  profile,
  action,
  payload,
  expectedVersion,
  label,
  onComplete,
  accountId,
  restoreOperationId,
  disabled = false,
}: {
  profile: PublicProfile;
  action: string;
  payload: Record<string, unknown>;
  expectedVersion: string | null;
  label: string;
  onComplete?: () => void;
  accountId?: string;
  restoreOperationId?: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const requiresApi = action === "cron.run-now" || action === "fraud.review";
  const allowed =
    !disabled &&
    (!requiresApi || profile.hasApi) &&
    profile.writable &&
    profile.capabilities.includes(requiresApi ? "commands" : "settings:write");
  const disabledReason =
    !requiresApi || profile.hasApi
      ? "Writes require deployment enablement and an explicit capability"
      : "Configure the OMS API connection to execute this command";
  async function prepare() {
    setAck("");
    setError("");
    setBusy(true);
    try {
      setPreview(
        await request<Preview>("operations", {
          body: JSON.stringify(
            restoreOperationId
              ? { kind: "restore", operationId: restoreOperationId }
              : {
                  data: {
                    accountId,
                    action,
                    expectedVersion,
                    payload,
                    profileId: profile.id,
                    revision: profile.revision,
                  },
                  kind: "prepare",
                }
          ),
          method: "POST",
        })
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!preview) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("operations", {
        body: JSON.stringify({
          acknowledgement: ack,
          confirmation: preview.confirmation,
          kind: "execute",
          operationId: preview.operationId,
        }),
        method: "POST",
      });
      setPreview(null);
      onComplete?.();
      await client.invalidateQueries({ queryKey: ["oms"] });
      await client.invalidateQueries({ queryKey: ["oms-operations"] });
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
      await client.invalidateQueries({ queryKey: ["oms-operations"] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={!allowed || busy}
        onClick={prepare}
        size="sm"
        title={allowed ? undefined : disabledReason}
        type="button"
      >
        {busy ? <LoaderCircle className="animate-spin" /> : null}
        {busy ? <span>Working…</span> : <span>{label}</span>}
      </Button>
      {error ? <ErrorNotice message={error} /> : null}
      <Dialog
        onOpenChange={(open) => open || setPreview(null)}
        open={!!preview}
      >
        {preview ? (
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{preview.action}</DialogTitle>
              <DialogDescription>
                Review the exact change before it is saved to this connection.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Alert
                className={
                  preview.target.safetyClass === "production"
                    ? "border-(--alert-warning-border) bg-(--alert-warning-bg)"
                    : ""
                }
              >
                <AlertTitle>{preview.target.name}</AlertTitle>
                <AlertDescription>
                  Revision {preview.target.revision} ·{" "}
                  {preview.target.safetyClass}
                </AlertDescription>
              </Alert>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-2 font-medium text-sm">Before</h3>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-sunken p-3 text-xs">
                    {JSON.stringify(preview.before, null, 2)}
                  </pre>
                </div>
                <div className="min-w-0">
                  <h3 className="mb-2 font-medium text-sm">After</h3>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-sunken p-3 text-xs">
                    {JSON.stringify(preview.after, null, 2)}
                  </pre>
                </div>
              </div>
              {preview.target.safetyClass === "production" ? (
                <FormField
                  id="production-ack"
                  label="Type production to confirm"
                >
                  <Input
                    autoComplete="off"
                    id="production-ack"
                    onChange={(event) => setAck(event.target.value)}
                    value={ack}
                  />
                </FormField>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Confirmation expires{" "}
                {new Date(preview.expiresAt).toLocaleTimeString()}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => setPreview(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  busy ||
                  (preview.target.safetyClass === "production" &&
                    ack !== "production")
                }
                onClick={execute}
                type="button"
              >
                Confirm change
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
export function OperationHistory({ profile }: { profile: PublicProfile }) {
  const [error, setError] = useState("");
  const query = useQuery({
    queryFn: ({ signal }) =>
      request<{
        operations: Array<{
          id: string;
          action: string;
          state: string;
          revision: number;
          created_at: string;
        }>;
      }>(
        "operations?" +
          new URLSearchParams({
            profileId: profile.id,
            revision: String(profile.revision),
          }),
        { signal }
      ),
    queryKey: ["oms-operations", profile.id, profile.revision],
    refetchInterval: 15_000,
  });
  async function reconcile(id: string) {
    setError("");
    try {
      await request("operations", {
        body: JSON.stringify({ kind: "reconcile", operationId: id }),
        method: "POST",
      });
      await query.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  let historyContent = (
    <p className="py-6 text-center text-muted-foreground text-sm">
      No operations for this connection.
    </p>
  );
  if (query.error) {
    historyContent = <ErrorNotice message={query.error.message} />;
  } else if (query.data?.operations.length) {
    historyContent = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Operation</TableHead>
            <TableHead>Revision</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.operations.map((op) => (
            <TableRow key={op.id}>
              <TableCell className="whitespace-normal">
                {op.action === "maintenance.update" &&
                  op.state === "completed" &&
                  op.revision === profile.revision && (
                    <OperationButton
                      action="maintenance.update"
                      expectedVersion={null}
                      label="Review restore"
                      payload={{}}
                      profile={profile}
                      restoreOperationId={op.id}
                    />
                  )}
                <span className="block font-medium">{op.action}</span>
                <span className="block font-mono text-muted-foreground text-xs">
                  {op.id}
                </span>
              </TableCell>
              <TableCell>{op.revision}</TableCell>
              <TableCell>
                <Badge variant="outline">{op.state}</Badge>
              </TableCell>
              <TableCell>{new Date(op.created_at).toLocaleString()}</TableCell>
              <TableCell>
                {["accepted", "running", "unknown"].includes(op.state) ? (
                  <Button
                    onClick={() => reconcile(op.id)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    Check result
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return (
    <Panel
      description="Check uncertain results before another write. Recovery confirms completion or safely cancels an operation that has not run."
      title="Recent operations"
    >
      <div className="flex flex-col gap-3">
        {error ? <ErrorNotice message={error} /> : null}
        {historyContent}
      </div>
    </Panel>
  );
}
export function MaintenanceEditor({
  profile,
  data,
  setDirty,
}: {
  profile: PublicProfile;
  data: {
    value: { enabled: boolean; exceptions: string[] };
    version: string | null;
  };
  setDirty: (dirty: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(data.value.enabled);
  const [exceptions, setExceptions] = useState(
    data.value.exceptions.join("\n")
  );
  return (
    <Panel
      description={
        <>
          Control maintenance for <strong>{profile.name}</strong>. Exceptions
          are exact page paths.
        </>
      }
      title="Maintenance mode"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            id="maintenance-enabled"
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setDirty(true);
            }}
          />
          <label className="text-sm" htmlFor="maintenance-enabled">
            Redirect pages to the maintenance notice
          </label>
        </div>
        <FormField
          description="Enter one exact path per line. Leave blank to redirect all pages except Site Config. Existing access permissions still apply."
          id="maintenance-paths"
          label="Page exceptions"
        >
          <Textarea
            id="maintenance-paths"
            onChange={(event) => {
              setExceptions(event.target.value);
              setDirty(true);
            }}
            placeholder="/orders"
            rows={6}
            value={exceptions}
          />
        </FormField>
        <OperationButton
          action="maintenance.update"
          expectedVersion={data.version}
          label="Save maintenance settings"
          onComplete={() => setDirty(false)}
          payload={{
            enabled,
            exceptions: exceptions
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          }}
          profile={profile}
        />
        {profile.writable ? null : (
          <p className="text-muted-foreground text-xs">
            Writes are disabled for this deployment.
          </p>
        )}
      </div>
    </Panel>
  );
}
