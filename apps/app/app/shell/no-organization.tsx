"use client";

import { BrandIcon, Button, Input, ShellHeader } from "@repo/design-system";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import { useState } from "react";
import { useCreateOrganization } from "./use-create-organization";

/** Shown in the panel instead of any page while the user has no organization. */
export const NoOrganization = () => {
  const [name, setName] = useState("");
  const { create, error, isPending } = useCreateOrganization();
  return (
    <div className="grid min-h-full place-items-center px-6 py-10">
      <ShellHeader crumbs={[{ label: "Welcome" }]} />
      <form
        className="flex w-full max-w-[320px] flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          create(name);
        }}
      >
        <span className="text-brand-ink">
          <BrandIcon size={40} />
        </span>
        <h1 className="font-semibold text-xl leading-7 tracking-[-0.018em]">
          Create your first organization
        </h1>
        <p className="text-[13px] text-muted-foreground leading-5">
          Stores, flows and backups belong to an organization. You can invite
          your team after.
        </p>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="first-organization-name">
            Organization name
          </FieldLabel>
          <Input
            aria-describedby={error ? "no-organization-error" : undefined}
            aria-invalid={error ? true : undefined}
            id="first-organization-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Wizloft Studio"
            value={name}
          />
          {error ? (
            <FieldError id="no-organization-error">{error}</FieldError>
          ) : null}
        </Field>
        <Button className="w-full" disabled={isPending} type="submit">
          {isPending ? "Creating…" : "Create organization"}
        </Button>
        <p className="text-muted-foreground text-xs leading-4">
          Have an invite? Open the link from your email.
        </p>
      </form>
    </div>
  );
};
