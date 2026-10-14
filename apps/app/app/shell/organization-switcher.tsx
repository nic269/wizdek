"use client";

import {
  Button,
  Check,
  ChevronsUpDown,
  IdentityChip,
  Input,
  Plus,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@repo/design-system/components/ui/field";
import { useState } from "react";
import {
  type Organization,
  useActiveOrganization,
} from "../lib/active-organization";
import { useCreateOrganization } from "./use-create-organization";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export const organizationMeta = (organization: Organization) =>
  `${plural(organization.storeCount, "store")} · ${plural(organization.memberCount, "member")}`;

const CreateOrganizationDialog = ({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const [name, setName] = useState("");
  const { create, error, isPending } = useCreateOrganization();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[420px]">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await create(name)) {
              setName("");
              onOpenChange(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Stores, flows, saved queries and database connections all belong
              to an organization. You become its Owner.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="new-organization-name">Name</FieldLabel>
            <Input
              aria-invalid={error ? true : undefined}
              autoFocus
              id="new-organization-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Organization name, e.g. wizloft"
              value={name}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** The active organization at the top of the sidebar, with the others to switch to. */
export const OrganizationSwitcher = () => {
  const { isLoading, organization, organizations, setOrganizationId } =
    useActiveOrganization();
  const [creating, setCreating] = useState(false);

  if (isLoading && !organization) {
    return (
      <div className="h-[38px] animate-pulse rounded-lg border border-sidebar-border bg-sidebar-field" />
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={
                organization
                  ? `Switch organization, current: ${organization.name}`
                  : "Create an organization"
              }
              className="h-auto w-full justify-start in-data-[collapsed=true]:justify-center gap-[9px] rounded-lg border-sidebar-border bg-sidebar-field p-1.5 text-left font-normal text-sidebar-foreground hover:bg-sidebar-field"
              title="Switch organization"
              variant="outline"
            />
          }
        >
          {organization ? (
            <IdentityChip
              id={organization.id}
              name={organization.name}
              size={24}
              variant="organization"
            />
          ) : (
            <span className="grid size-6 place-items-center rounded-md bg-sidebar-hover text-sidebar-muted">
              <Plus className="size-3.5" />
            </span>
          )}
          <span className="flex in-data-[collapsed=true]:hidden min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-[13px] leading-[1.2]">
              {organization?.name ?? "No organization"}
            </span>
            <span className="truncate text-[11.5px] text-sidebar-muted leading-[1.2]">
              {organization
                ? organizationMeta(organization)
                : "Create one to start"}
            </span>
          </span>
          <ChevronsUpDown className="in-data-[collapsed=true]:hidden size-3.5 text-sidebar-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-60 p-1.5"
          sideOffset={6}
        >
          {organizations.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 pt-2 pb-1.5 font-medium text-[11px] text-muted-foreground">
                Organizations
              </DropdownMenuLabel>
              {organizations.map((item) => (
                <DropdownMenuItem
                  className="gap-[9px] px-2 py-[7px]"
                  key={item.id}
                  onClick={() => {
                    if (item.id !== organization?.id) {
                      setOrganizationId(item.id);
                      toast.info("Switched organization", {
                        description: `Now working in ${item.name}`,
                      });
                    }
                  }}
                >
                  <IdentityChip
                    id={item.id}
                    name={item.name}
                    size={22}
                    variant="organization"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-[13px] leading-[1.2]">
                      {item.name}
                    </span>
                    <span className="truncate text-[11.5px] text-muted-foreground leading-[1.2]">
                      {organizationMeta(item)}
                    </span>
                  </span>
                  {item.id === organization?.id ? (
                    <Check aria-label="Active" className="size-3.5" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {organizations.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            className="gap-[9px] px-2 py-[7px] font-medium text-[13px]"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-[15px]" />
            Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog onOpenChange={setCreating} open={creating} />
    </>
  );
};
