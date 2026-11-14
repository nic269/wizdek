"use client";
import { Button, Eye, Input, LoaderCircle, Lock, X } from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/design-system/components/ui/sheet";
import { type FormEvent, useState } from "react";
import type { PublicProfile, SafetyClass } from "../lib/contracts";
import { request } from "./management-app";
import { ChoiceSelect, ErrorNotice } from "./oms-ui";

export function AddConnection({
  onClose,
  onSaved,
  onDirty,
}: {
  onClose: () => void;
  onSaved: (profileId?: string) => void;
  onDirty: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiOrigin, setApiOrigin] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [environment, setEnvironment] = useState<SafetyClass>("staging");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (Boolean(apiOrigin.trim()) !== Boolean(apiToken.trim())) {
      setError(
        "Enter both the API URL and service token, or leave both empty."
      );
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ profile: PublicProfile }>("profiles", {
        body: JSON.stringify({
          action: "save-url",
          data: {
            environment,
            name,
            url,
            ...(apiOrigin.trim()
              ? { api: { origin: apiOrigin.trim(), token: apiToken.trim() } }
              : {}),
          },
        }),
        method: "POST",
      });
      setUrl("");
      setApiToken("");
      onSaved(result.profile.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the connection."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onClose();
        }
      }}
      open
    >
      <SheetContent
        className="w-[min(440px,calc(100vw-16px))] gap-0 p-0 sm:max-w-none"
        showCloseButton={false}
        side="right"
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onChange={onDirty}
          onSubmit={submit}
        >
          <div className="flex items-center border-border border-b px-5 py-[18px]">
            <div className="flex-1">
              <SheetTitle className="font-semibold text-base">
                Add a connection
              </SheetTitle>
              <SheetDescription className="text-muted-foreground text-xs">
                We test the connection and check OMS features before saving.
              </SheetDescription>
            </div>
            <Button
              aria-label="Close"
              disabled={busy}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
            {error ? <ErrorNotice message={error} /> : null}
            <Field className="gap-1.5">
              <FieldLabel htmlFor="oms-connection-name">Name</FieldLabel>
              <Input
                id="oms-connection-name"
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="OMS Staging"
                required
                value={name}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="oms-database-url">Database URL</FieldLabel>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Lock className="pointer-events-none absolute top-[10px] left-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    autoComplete="off"
                    className="pl-[30px] font-mono text-[13px]"
                    id="oms-database-url"
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/database"
                    required
                    spellCheck={false}
                    type={visible ? "text" : "password"}
                    value={url}
                  />
                </div>
                <Button
                  aria-label={visible ? "Hide URL" : "Show URL"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Eye />
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Stored encrypted. The saved password is never shown again. Only
                sslmode is used from URL options.
              </p>
            </Field>
            <ChoiceSelect
              choices={[
                { label: "Staging", value: "staging" },
                { label: "Production", value: "production" },
                { label: "Other", value: "custom" },
              ]}
              id="oms-connection-environment"
              label="Environment"
              onValueChange={(value) => {
                setEnvironment(value as SafetyClass);
                onDirty();
              }}
              value={environment}
            />
            <details className="rounded-card p-4 shadow-card">
              <summary className="cursor-pointer font-medium text-sm">
                Optional OMS API connection
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="oms-api-url">API URL</FieldLabel>
                  <Input
                    id="oms-api-url"
                    onChange={(e) => setApiOrigin(e.target.value)}
                    placeholder="https://staging-oms.example.com"
                    type="url"
                    value={apiOrigin}
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="oms-api-token">Service token</FieldLabel>
                  <Input
                    autoComplete="new-password"
                    id="oms-api-token"
                    minLength={32}
                    onChange={(e) => setApiToken(e.target.value)}
                    type="password"
                    value={apiToken}
                  />
                </Field>
                <p className="text-muted-foreground text-xs">
                  For running cronjobs and Fraud review. We automatically check
                  that this API uses the selected database.
                </p>
              </div>
            </details>
            <p className="text-muted-foreground text-xs">
              Manage logs and site settings across this database. No OMS login
              or account ID is needed. The API connection is optional and can be
              added later.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-border border-t px-5 py-3.5">
            <Button
              disabled={busy}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {busy ? "Testing connection…" : "Test & save"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
