"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  Copy,
  ErrorAlert,
  Input,
  Plus,
  Trash2,
  toast,
} from "@repo/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { HTTP_TRIGGER, SCHEDULE_LIMITS } from "@repo/functions/definition";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Checkbox, Field } from "../../lib/form-parts";
import { JsonField, SchemaForm } from "../../lib/schema-form";
import { paramsToSend } from "./test-tab";
import type { CodeFunction } from "./use-function-editor";

type Params = Record<string, unknown>;
type HttpTrigger = CodeFunction["httpTrigger"];
type Schedule = Awaited<
  ReturnType<typeof apiClient.functionSchedules.list>
>["data"][number];

const schedulesKey = (functionId: string) =>
  ["function-schedules", functionId] as const;

const copy = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied", { description: label });
  } catch {
    toast.error("Could not copy", { description: label });
  }
};

const triggerUrlOf = (functionId: string) =>
  `${window.location.origin}${HTTP_TRIGGER.pathPrefix}/${functionId}`;

const curlOf = (functionId: string, token: string) =>
  [
    `curl -X POST '${triggerUrlOf(functionId)}' \\`,
    `  -H '${HTTP_TRIGGER.header}: ${token}' \\`,
    "  -H 'content-type: application/json' \\",
    "  -d '{}'",
  ].join("\n");

/** Shows a new token once, with a ready-to-paste curl call. */
const TokenDialog = ({
  functionId,
  onClose,
  token,
}: {
  functionId: string;
  onClose: () => void;
  token: string | null;
}) => (
  <Dialog
    onOpenChange={(open) => (open ? null : onClose())}
    open={token !== null}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Copy the token now</DialogTitle>
        <DialogDescription>
          It is shown only this once. Callers send it in the{" "}
          <code className="font-mono">{HTTP_TRIGGER.header}</code> header.
        </DialogDescription>
      </DialogHeader>
      {token ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-sunken px-2 py-1.5 font-mono text-[12px]"
              data-testid="http-token"
            >
              {token}
            </code>
            <Button
              onClick={() => copy(token, "Token")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Copy className="size-3" />
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-sunken p-2 font-mono text-[11.5px] leading-[1.45]">
            {curlOf(functionId, token)}
          </pre>
          <Button
            onClick={() => copy(curlOf(functionId, token), "curl command")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Copy className="size-3" />
            Copy curl
          </Button>
        </div>
      ) : null}
      <DialogFooter>
        <Button onClick={onClose} type="button">
          Done
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

const HttpTriggerSection = ({
  canManage,
  fn,
}: {
  canManage: boolean;
  fn: CodeFunction;
}) => {
  const [state, setState] = useState<HttpTrigger>(fn.httpTrigger);
  const [token, setToken] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  useEffect(() => setState(fn.httpTrigger), [fn.httpTrigger]);

  const act = async (action: "enable" | "rotate" | "disable") => {
    setIsWorking(true);
    try {
      const input = { functionId: fn.id };
      if (action === "disable") {
        const { data } = await apiClient.functions.disableHttpTrigger(input);
        setState(data);
        toast.success("HTTP trigger turned off");
      } else {
        const { data } =
          action === "enable"
            ? await apiClient.functions.enableHttpTrigger(input)
            : await apiClient.functions.rotateHttpToken(input);
        setState(data.httpTrigger);
        setToken(data.token);
      }
    } catch (cause) {
      toast.error("Could not change the HTTP trigger", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-[13px]">HTTP trigger</h3>
      {state.enabled ? (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            On. POST JSON parameters to this URL with the token. The call waits
            up to 90 seconds for the result, then answers with the run id.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate font-mono text-[12px]"
              data-testid="http-url"
            >
              {HTTP_TRIGGER.pathPrefix}/{fn.id}
            </code>
            <Button
              aria-label="Copy the trigger URL"
              onClick={() => copy(triggerUrlOf(fn.id), "Trigger URL")}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Copy className="size-3" />
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Token ending in{" "}
            <code className="font-mono">…{state.tokenHint}</code>
          </p>
          {canManage ? (
            <div className="flex gap-2">
              <Button
                disabled={isWorking}
                onClick={() => act("rotate")}
                size="sm"
                type="button"
                variant="outline"
              >
                New token
              </Button>
              <Button
                disabled={isWorking}
                onClick={() => act("disable")}
                size="sm"
                type="button"
                variant="outline"
              >
                Turn off
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            Off. Turn it on to call this function from outside Wizdek with its
            own token.
          </p>
          {canManage ? (
            <Button
              disabled={isWorking}
              onClick={() => act("enable")}
              size="sm"
              type="button"
            >
              Turn on
            </Button>
          ) : null}
        </>
      )}
      <TokenDialog
        functionId={fn.id}
        onClose={() => setToken(null)}
        token={token}
      />
    </section>
  );
};

const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const ScheduleForm = ({
  fn,
  onCreated,
}: {
  fn: CodeFunction;
  onCreated: () => Promise<unknown>;
}) => {
  const [cron, setCron] = useState("0 * * * *");
  const [timezone, setTimezone] = useState(localTimeZone);
  const [values, setValues] = useState<Params>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const schema = fn.paramsSchema;
  const hasFields = schema && Object.keys(schema.properties).length > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.functionSchedules.create({
        cron,
        enabled: true,
        functionId: fn.id,
        params: paramsToSend(fn, values),
        timezone,
      });
      toast.success("Schedule added", { description: cron });
      await onCreated();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not add the schedule."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={submit}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field hint="Minute hour day month weekday." label="Cron">
          <Input
            aria-label="Cron"
            className="font-mono"
            onChange={(event) => setCron(event.target.value)}
            value={cron}
          />
        </Field>
        <Field label="Time zone">
          <Input
            aria-label="Time zone"
            onChange={(event) => setTimezone(event.target.value)}
            value={timezone}
          />
        </Field>
      </div>
      {schema && hasFields ? (
        <SchemaForm
          disabled={false}
          onChange={setValues}
          schema={schema}
          values={values}
        />
      ) : null}
      {schema ? null : (
        <JsonField
          disabled={false}
          label="Parameters as JSON"
          onChange={(value) =>
            setValues(
              value && typeof value === "object" && !Array.isArray(value)
                ? (value as Params)
                : {}
            )
          }
          rows={4}
          value={values}
        />
      )}
      {error ? <ErrorAlert message={error} title="Not added." /> : null}
      <Button disabled={isSaving || !cron.trim()} size="sm" type="submit">
        {isSaving ? "Adding…" : "Add schedule"}
      </Button>
    </form>
  );
};

const ScheduleRow = ({
  canManage,
  onChanged,
  schedule,
}: {
  canManage: boolean;
  onChanged: () => Promise<unknown>;
  schedule: Schedule;
}) => {
  const [isWorking, setIsWorking] = useState(false);
  const change = async (work: () => Promise<unknown>, failure: string) => {
    setIsWorking(true);
    try {
      await work();
      await onChanged();
    } catch (cause) {
      toast.error(failure, {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsWorking(false);
    }
  };
  const params = Object.keys(schedule.params).length
    ? JSON.stringify(schedule.params)
    : null;
  return (
    <li
      className="flex items-start justify-between gap-2 px-3 py-2"
      data-testid="schedule"
    >
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[12.5px]">{schedule.cron}</p>
        <p className="text-[11.5px] text-muted-foreground">
          {schedule.timezone}
          {params ? ` · ${params}` : ""}
        </p>
        <Checkbox
          checked={schedule.enabled}
          disabled={!canManage || isWorking}
          label="Enabled"
          onChange={(enabled) =>
            change(
              () =>
                apiClient.functionSchedules.update({
                  enabled,
                  scheduleId: schedule.id,
                }),
              "Could not change the schedule"
            )
          }
        />
      </div>
      {canManage ? (
        <Button
          aria-label={`Delete schedule ${schedule.cron}`}
          disabled={isWorking}
          onClick={() =>
            change(
              () =>
                apiClient.functionSchedules.delete({ scheduleId: schedule.id }),
              "Could not delete the schedule"
            )
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
};

const SchedulesSection = ({
  canManage,
  fn,
}: {
  canManage: boolean;
  fn: CodeFunction;
}) => {
  const queryClient = useQueryClient();
  const schedules = useQuery({
    queryFn: async () =>
      (await apiClient.functionSchedules.list({ functionId: fn.id })).data,
    queryKey: schedulesKey(fn.id),
  });
  const [isAdding, setIsAdding] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: schedulesKey(fn.id) });
  const count = schedules.data?.length ?? 0;

  return (
    <section className="space-y-2 border-border border-t pt-4">
      <h3 className="font-semibold text-[13px]">Schedules</h3>
      <p className="text-[12.5px] text-muted-foreground">
        Each schedule starts a run with its own parameters, at most once a
        minute.
      </p>
      {schedules.error ? (
        <ErrorAlert
          message={getApiErrorMessage(
            schedules.error,
            "Could not load the schedules."
          )}
          title="Not loaded."
        />
      ) : null}
      {count > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {schedules.data?.map((schedule) => (
            <ScheduleRow
              canManage={canManage}
              key={schedule.id}
              onChanged={refresh}
              schedule={schedule}
            />
          ))}
        </ul>
      ) : null}
      {schedules.data && count === 0 ? (
        <p className="text-[13px] text-muted-foreground">No schedules yet.</p>
      ) : null}
      {canManage && isAdding ? (
        <ScheduleForm
          fn={fn}
          onCreated={async () => {
            setIsAdding(false);
            await refresh();
          }}
        />
      ) : null}
      {canManage && !isAdding && count < SCHEDULE_LIMITS.perFunction ? (
        <Button
          onClick={() => setIsAdding(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus className="size-3" />
          Add schedule
        </Button>
      ) : null}
    </section>
  );
};

/** How the function starts besides the Run button: HTTP and schedules. */
export function TriggersTab({
  canManage,
  fn,
}: {
  canManage: boolean;
  fn: CodeFunction;
}) {
  return (
    <div className="space-y-4 p-4">
      <HttpTriggerSection canManage={canManage} fn={fn} />
      <SchedulesSection canManage={canManage} fn={fn} />
    </div>
  );
}
