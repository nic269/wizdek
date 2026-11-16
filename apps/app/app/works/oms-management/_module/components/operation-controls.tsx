"use client";
import {
  Button,
  EnvTag,
  InlineAlert,
  Input,
  LoaderCircle,
  StatusBadge,
} from "@repo/design-system";
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
  variant = "default",
}: {
  /** `outline` for secondary actions in rows; the default is the primary. */
  variant?: "default" | "outline";
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
        variant={variant}
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
            <ConfirmTarget target={preview.target} />
            <DialogHeader>
              <DialogTitle>{preview.action}</DialogTitle>
              <DialogDescription>
                Review the exact change before it is saved to this connection.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-1.5 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
                    Before
                  </h3>
                  <pre className="max-h-72 overflow-auto rounded-[10px] bg-sunken px-3.5 py-3 font-mono text-[12px] text-foreground-2 leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
                    {JSON.stringify(preview.before, null, 2)}
                  </pre>
                </div>
                <div className="min-w-0">
                  <h3 className="mb-1.5 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
                    After
                  </h3>
                  <pre className="max-h-72 overflow-auto rounded-[10px] bg-sunken px-3.5 py-3 font-mono text-[12px] text-foreground-2 leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
                    {JSON.stringify(preview.after, null, 2)}
                  </pre>
                </div>
              </div>
              {preview.target.safetyClass === "production" ? (
                <FormField
                  id="production-ack"
                  label={
                    <>
                      Type <span className="text-prod-ink">production</span> to
                      confirm
                    </>
                  }
                >
                  <Input
                    autoComplete="off"
                    className="border-prod focus-visible:border-prod focus-visible:ring-prod/15"
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
                variant="ghost"
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
                variant={
                  preview.target.safetyClass === "production"
                    ? "danger"
                    : "default"
                }
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
/** The environment a confirmed change will hit; production gets a red bar. */
function ConfirmTarget({
  target,
}: {
  target: { name: string; revision: number; safetyClass: string };
}) {
  const production = target.safetyClass === "production";
  return (
    <>
      {production ? (
        <div aria-hidden="true" className="h-1 flex-none bg-prod" />
      ) : null}
      <div className="flex items-center gap-2.5 px-[22px] pt-5">
        <EnvTag environment={production ? "PROD" : "STAGING"} />
        <span className="text-faint text-xs tabular-nums">
          {target.name} · revision {target.revision}
        </span>
      </div>
    </>
  );
}

/** Operation states as the shared status vocabulary; unknown stays loud. */
const OPERATION_STATUS: Record<string, string> = {
  accepted: "QUEUED",
  canceled: "CANCELED",
  cancelled: "CANCELED",
  completed: "COMPLETED",
  failed: "FAILED",
  pending: "QUEUED",
  running: "RUNNING",
  unknown: "UNKNOWN",
};
const sentenceCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

const OPERATION_LABELS: Record<string, string> = {
  accepted: "Accepted",
  canceled: "Canceled",
  cancelled: "Canceled",
  completed: "Completed",
  failed: "Failed",
  pending: "Pending",
  running: "Running",
  unknown: "Uncertain",
};

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
    <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
      No operations for this connection.
    </p>
  );
  if (query.error) {
    historyContent = (
      <div className="px-4">
        <ErrorNotice message={query.error.message} />
      </div>
    );
  } else if (query.data?.operations.length) {
    historyContent = (
      <Table containerClassName="rounded-none shadow-none">
        <TableHeader>
          <TableRow>
            <TableHead>Operation</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Revision</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.operations.map((op) => (
            <TableRow key={op.id}>
              <TableCell className="whitespace-normal">
                <span className="block font-[550]">{op.action}</span>
                <span className="block text-muted-foreground text-xs tabular-nums">
                  {op.id}
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={OPERATION_STATUS[op.state] ?? "QUEUED"}>
                  {OPERATION_LABELS[op.state] ?? sentenceCase(op.state)}
                </StatusBadge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {op.revision}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {new Date(op.created_at).toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {op.action === "maintenance.update" &&
                op.state === "completed" &&
                op.revision === profile.revision ? (
                  <OperationButton
                    action="maintenance.update"
                    expectedVersion={null}
                    label="Review restore"
                    payload={{}}
                    profile={profile}
                    restoreOperationId={op.id}
                    variant="outline"
                  />
                ) : null}
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
  const uncertain =
    query.data?.operations.filter((op) => op.state === "unknown").length ?? 0;
  return (
    <Panel
      action={
        <span className="text-faint text-xs tabular-nums">
          revision {profile.revision}
        </span>
      }
      bodyClassName="px-0"
      title="Recent operations"
    >
      <div className="flex flex-col gap-3">
        {uncertain > 0 ? (
          <InlineAlert
            className="mx-4"
            title={
              uncertain === 1
                ? "1 operation is uncertain."
                : `${uncertain} operations are uncertain.`
            }
            tone="unknown"
          >
            The OMS accepted the request but never confirmed it. Check the
            result before another write.
          </InlineAlert>
        ) : null}
        {error ? (
          <div className="px-4">
            <ErrorNotice message={error} />
          </div>
        ) : null}
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
      action={
        <StatusBadge tone={data.value.enabled ? "warning" : "neutral"}>
          {data.value.enabled ? "On" : "Off"}
        </StatusBadge>
      }
      description={
        <>
          Control maintenance for <strong>{profile.name}</strong>. Exceptions
          are exact page paths.
        </>
      }
      title="Maintenance mode"
    >
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-start gap-3">
          <Switch
            checked={enabled}
            className={
              profile.safetyClass === "production"
                ? "data-checked:bg-prod"
                : undefined
            }
            id="maintenance-enabled"
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setDirty(true);
            }}
          />
          <label
            className="flex flex-col gap-0.5 text-[13px]"
            htmlFor="maintenance-enabled"
          >
            <span className="font-[550]">
              Redirect pages to the maintenance notice
            </span>
            <span className="text-muted-foreground text-xs">
              Visitors see the maintenance page except on the paths below.
            </span>
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
