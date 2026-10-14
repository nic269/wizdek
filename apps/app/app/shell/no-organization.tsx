"use client";

import { Building2, Button, Input } from "@repo/design-system";
import { useState } from "react";
import { useCreateOrganization } from "./use-create-organization";

/** Shown in the panel instead of any page while the user has no organization. */
export const NoOrganization = () => {
  const [name, setName] = useState("");
  const { create, error, isPending } = useCreateOrganization();
  return (
    <div className="grid min-h-full place-items-center px-6 py-10">
      <div className="flex max-w-[420px] flex-col items-center gap-3.5 text-center">
        <div className="grid size-12 place-items-center rounded-[12px] border border-border bg-sunken text-muted-foreground">
          <Building2 className="size-[22px]" />
        </div>
        <h1 className="font-semibold text-xl leading-[1.2] tracking-[-0.015em]">
          Create your first organization
        </h1>
        <p className="text-pretty text-muted-foreground text-sm leading-[1.55]">
          Stores, flows, saved queries and database connections all belong to an
          organization. You can invite teammates once it exists.
        </p>
        <form
          className="mt-1.5 flex w-full max-w-[360px] gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create(name);
          }}
        >
          <Input
            aria-describedby={error ? "no-organization-error" : undefined}
            aria-invalid={error ? true : undefined}
            aria-label="Organization name"
            className="h-9 text-sm"
            onChange={(event) => setName(event.target.value)}
            placeholder="Organization name, e.g. wizloft"
            value={name}
          />
          <Button className="h-9" disabled={isPending} type="submit">
            {isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        {error ? (
          <p
            className="text-destructive text-sm"
            id="no-organization-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <p className="text-[12.5px] text-muted-foreground leading-[1.4]">
          Have an invitation? Open the link from your email to join an existing
          organization.
        </p>
      </div>
    </div>
  );
};
