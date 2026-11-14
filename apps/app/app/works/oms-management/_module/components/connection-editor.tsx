"use client";
import { Button, LoaderCircle } from "@repo/design-system";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PublicProfile } from "../lib/contracts";
import { AddConnection } from "./add-connection";
import { request } from "./management-app";
import { CheckboxField, ErrorNotice, TextField } from "./oms-ui";

interface ConnectionDetails {
  accountIds: string[];
  api: {
    origin: string;
  } | null;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    tls: boolean;
    verifyTls?: boolean;
  };
  globalDiagnostics: boolean;
  presetChanged: boolean;
}

function askForConfirmation(message: string) {
  const confirmAction = window.confirm;
  return confirmAction(message);
}

function passwordUpdate(form: FormData, password: string, editing: boolean) {
  if (form.has("clearPassword")) {
    return { mode: "clear" } as const;
  }
  if (password) {
    return { mode: "replace", value: password } as const;
  }
  return { mode: editing ? "keep" : "clear" } as const;
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function apiUpdate(origin: string, token: string, savedOrigin?: string) {
  if (token && !origin) {
    throw new Error("Enter an API URL for this service token.");
  }
  if (origin && !token && !savedOrigin) {
    throw new Error("Enter the service token for this API connection.");
  }
  if (
    origin &&
    !token &&
    normalizedOrigin(origin) !== normalizedOrigin(savedOrigin ?? "")
  ) {
    throw new Error("Enter a new service token when changing the API URL.");
  }
  return origin
    ? {
        origin,
        token: token ? { mode: "replace", value: token } : { mode: "keep" },
      }
    : null;
}

export function ConnectionEditor(props: {
  profile: PublicProfile | null;
  onClose: () => void;
  onSaved: (profileId?: string) => void;
  onDirty: () => void;
}) {
  return props.profile ? (
    <EditConnection {...props} />
  ) : (
    <AddConnection {...props} />
  );
}

function EditConnection({
  profile,
  onClose,
  onSaved,
  onDirty,
}: {
  profile: PublicProfile | null;
  onClose: () => void;
  onSaved: () => void;
  onDirty: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const details = useQuery({
    enabled: !!profile,
    queryFn: ({ signal }) => {
      if (!profile) {
        throw new Error("A connection is required to load its details.");
      }
      return request<ConnectionDetails>(
        "profiles?" +
          new URLSearchParams({
            id: profile.id,
            revision: String(profile.revision),
          }),
        { signal }
      );
    },
    queryKey: ["oms-profile-editor", profile?.id, profile?.revision],
  });
  async function changeState(action: "disable" | "reset") {
    if (
      !(
        profile &&
        askForConfirmation(
          action === "reset"
            ? "Validate and restore the server preset as a new revision?"
            : "Disable this connection? Existing history will be retained."
        )
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("profiles", {
        body: JSON.stringify({
          action,
          data: { profileId: profile.id, revision: profile.revision },
        }),
        method: "POST",
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const password = value("password");
    try {
      await request("profiles", {
        body: JSON.stringify({
          action: "save",
          data: {
            accountIds: details.data?.accountIds ?? [],
            api: apiUpdate(
              value("apiOrigin"),
              value("apiToken"),
              details.data?.api?.origin
            ),
            database: {
              host: value("host"),
              name: value("database"),
              password: passwordUpdate(form, password, !!profile),
              port: Number(value("port")),
              tls: form.has("tls"),
              user: value("user"),
              verifyTls: details.data?.database.verifyTls ?? true,
            },
            expectedRevision: profile?.revision ?? 0,
            globalDiagnostics: details.data?.globalDiagnostics ?? true,
            id: profile?.id ?? value("id"),
            name: value("name"),
          },
        }),
        method: "POST",
      });
      onSaved();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Connection could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog onOpenChange={(open) => open || (!busy && onClose())} open>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onChange={onDirty}
          onSubmit={submit}
        >
          <DialogHeader>
            <DialogTitle>
              {profile ? "Edit connection" : "Add connection"}
            </DialogTitle>
            <DialogDescription>
              The server validates access and database grants before saving a
              new revision. Credentials are encrypted and never returned to your
              browser.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {details.error ? (
              <ErrorNotice message={details.error.message} />
            ) : null}
            {profile && details.isPending ? (
              <p className="text-muted-foreground text-sm" role="status">
                Loading connection details…
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    defaultValue={profile?.id}
                    disabled={!!profile}
                    id="connection-id"
                    label="Connection ID"
                    name="id"
                    pattern="[a-zA-Z0-9_-]{1,80}"
                    required
                  />
                  <TextField
                    defaultValue={profile?.name}
                    id="connection-name"
                    label="Display name"
                    maxLength={80}
                    name="name"
                    required
                  />
                  <TextField
                    autoComplete="off"
                    defaultValue={details.data?.database.host}
                    id="database-host"
                    label="Database host"
                    name="host"
                    required
                  />
                  <TextField
                    defaultValue={details.data?.database.port ?? 5432}
                    id="database-port"
                    label="Port"
                    name="port"
                    required
                    type="number"
                  />
                  <TextField
                    defaultValue={details.data?.database.name}
                    id="database-name"
                    label="Database name"
                    name="database"
                    required
                  />
                  <TextField
                    autoComplete="off"
                    defaultValue={details.data?.database.user}
                    id="database-user"
                    label="DB user"
                    name="user"
                    required
                  />
                  <PasswordFields editing={!!profile} onDirty={onDirty} />
                  <CheckboxField
                    defaultChecked={details.data?.database.tls ?? true}
                    id="database-tls"
                    label="Use SSL/TLS"
                    name="tls"
                    onCheckedChange={onDirty}
                  />
                </div>
                <details className="rounded-card p-4 shadow-card">
                  <summary className="cursor-pointer font-medium text-sm">
                    Optional OMS API connection
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <TextField
                      className="sm:col-span-2"
                      defaultValue={details.data?.api?.origin}
                      id="api-origin"
                      label="API URL"
                      name="apiOrigin"
                      placeholder="https://oms-api.example.com"
                      type="url"
                    />
                    <TextField
                      autoComplete="new-password"
                      className="sm:col-span-2"
                      description={
                        details.data?.api
                          ? "Leave empty to keep the current token"
                          : "Use the OMS management service token"
                      }
                      id="api-token"
                      label="Service token"
                      minLength={32}
                      name="apiToken"
                      type="password"
                    />
                  </div>
                  <p className="mt-3 text-muted-foreground text-xs">
                    We automatically check that the API uses this database. No
                    database or deployment ID is needed.
                  </p>
                </details>
                <EditingHelp editing={!!profile} />
                {error ? <ErrorNotice message={error} /> : null}
                <ProfileActions
                  busy={busy}
                  editing={!!profile}
                  onChangeState={changeState}
                  preset={profile?.preset}
                  presetChanged={details.data?.presetChanged}
                />
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || (!!profile && details.isPending)}
              type="submit"
            >
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {busy ? "Validating connection…" : "Validate & save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordFields({
  editing,
  onDirty,
}: {
  editing: boolean;
  onDirty: () => void;
}) {
  return (
    <>
      <TextField
        autoComplete="new-password"
        description={
          editing ? "Leave empty to keep the current password" : undefined
        }
        id="database-password"
        label="DB password"
        name="password"
        type="password"
      />
      {editing ? (
        <CheckboxField
          id="clear-password"
          label="Clear the stored DB password"
          name="clearPassword"
          onCheckedChange={onDirty}
        />
      ) : null}
    </>
  );
}

function EditingHelp({ editing }: { editing: boolean }) {
  if (!editing) {
    return null;
  }
  return (
    <p className="text-muted-foreground text-xs">
      Enter the complete connection details for this revision. Empty passwords
      keep the existing secret. An empty API URL clears the API connection.
    </p>
  );
}

function ProfileActions({
  busy,
  editing,
  preset,
  presetChanged,
  onChangeState,
}: {
  busy: boolean;
  editing: boolean;
  preset?: string | null | undefined;
  presetChanged?: boolean | undefined;
  onChangeState: (action: "disable" | "reset") => Promise<void>;
}) {
  if (!editing) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2 rounded-card border border-(--alert-danger-border) p-3">
      <Button
        disabled={busy}
        onClick={() => onChangeState("disable")}
        type="button"
        variant="destructive"
      >
        Disable connection
      </Button>
      {preset ? (
        <Button
          disabled={busy}
          onClick={() => onChangeState("reset")}
          type="button"
          variant="outline"
        >
          {presetChanged
            ? "Apply updated server preset"
            : "Reset to server preset"}
        </Button>
      ) : null}
    </div>
  );
}
