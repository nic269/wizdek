"use client";

import type { apiClient } from "@repo/api/client";
import {
  Button,
  Check,
  ChevronDown,
  CircleCheck,
  cn,
  describeStatus,
  EnvTag,
  IdentityChip,
  TriangleAlert,
} from "@repo/design-system";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import { Label } from "@repo/design-system/components/ui/label";
import { Switch } from "@repo/design-system/components/ui/switch";
import { OptionSelect } from "../lib/option-select";
import type { Store } from "../stores/store-labels";
import { isWriteScope } from "../stores/store-labels";

export type ApiVersion = Awaited<
  ReturnType<typeof apiClient.shopifyGraphql.versions>
>["data"]["versions"][number];

const StorePicker = ({
  onStoreChange,
  store,
  stores,
}: {
  onStoreChange: (storeId: string) => void;
  store: Store | undefined;
  stores: Store[];
}) => {
  const prod = store?.environment === "PROD";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Store"
            className={cn(
              "h-9 min-w-[290px] justify-start gap-[9px] pr-2.5 pl-2 font-normal",
              prod &&
                "border-(--prod-border) bg-(--prod-bg) hover:bg-(--prod-bg)"
            )}
            variant="outline"
          />
        }
      >
        {store ? (
          <>
            <IdentityChip id={store.id} name={store.name} size={22} />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="truncate font-semibold text-[13px] leading-none">
                {store.name}
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground leading-none">
                {store.shopDomain}
              </span>
            </span>
            <EnvTag environment={store.environment} />
          </>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">
            Choose a store
          </span>
        )}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[340px] p-1.5"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-2 pb-1.5 font-medium text-[11.5px] text-muted-foreground">
            Connected stores
          </DropdownMenuLabel>
          {stores.map((item) => {
            const connected = item.status === "CONNECTED";
            return (
              <DropdownMenuItem
                className="gap-[9px] p-2"
                disabled={!connected}
                key={item.id}
                onClick={() => onStoreChange(item.id)}
              >
                <IdentityChip id={item.id} name={item.name} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[13px] leading-[1.25]">
                    {item.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground leading-[1.3]">
                    {connected
                      ? `Connected · ${item.scopes.length} scopes`
                      : describeStatus(item.status).label}
                  </span>
                </span>
                <EnvTag environment={item.environment} />
                {item.id === store?.id ? <Check className="size-3.5" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export function ConsoleToolbar({
  apiVersion,
  costDebug,
  onApiVersionChange,
  onCostDebugChange,
  onStoreChange,
  organizationName,
  store,
  stores,
  versions,
}: {
  apiVersion: string;
  costDebug: boolean;
  onApiVersionChange: (apiVersion: string) => void;
  onCostDebugChange: (costDebug: boolean) => void;
  onStoreChange: (storeId: string) => void;
  organizationName: string;
  store: Store | undefined;
  stores: Store[];
  versions: ApiVersion[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-border border-b px-4 py-3">
      <h1 className="mr-1.5 ml-1 font-semibold text-[17px] leading-none tracking-[-0.01em]">
        GraphQL
      </h1>
      <StorePicker
        onStoreChange={onStoreChange}
        store={store}
        stores={stores}
      />
      <OptionSelect
        aria-label="API version"
        className="h-9! w-auto font-mono text-[13px]"
        onValueChange={onApiVersionChange}
        options={versions.map((version) => ({
          label: version.displayName,
          value: version.handle,
        }))}
        value={apiVersion || null}
      />
      <Label className="h-9 gap-2 px-2 font-medium text-[13px] text-foreground-2">
        <Switch checked={costDebug} onCheckedChange={onCostDebugChange} />
        Detailed cost
      </Label>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <CircleCheck className="size-3.5" />
        Saved queries sync to {organizationName}
      </span>
    </div>
  );
}

/** The red strip under the toolbar while a production store is selected. */
export function ProductionBand({ store }: { store: Store }) {
  const writes = store.scopes.filter(isWriteScope);
  return (
    <div className="flex items-center gap-2.5 border-(--alert-danger-border) border-b bg-(--prod-band-bg) px-4 py-[7px] text-(--prod-band-fg) text-[12.5px] leading-[1.4]">
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="flex-1">
        <strong className="font-semibold">Production store.</strong> Mutations
        run here change live data on{" "}
        <span className="font-mono">{store.shopDomain}</span>.
      </span>
      {writes.length > 0 ? (
        <span className="hidden font-medium font-mono text-[11.5px] opacity-80 md:inline">
          {writes.slice(0, 2).join(" · ")}
          {writes.length > 2 ? ` +${writes.length - 2}` : ""} granted
        </span>
      ) : null}
    </div>
  );
}
