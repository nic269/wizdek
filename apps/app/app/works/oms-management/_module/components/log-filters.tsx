"use client";

import { Button, ChevronDown, Search } from "@repo/design-system";
import {
  Collapsible,
  CollapsibleContent,
} from "@repo/design-system/components/ui/collapsible";
import { useState } from "react";
import { ChoiceSelect, TextField } from "./oms-ui";
import { formatLogLabel } from "./workflow-types";

export interface LogFilterValues {
  actorId?: string;
  featureKey?: string;
  from?: string;
  module?: string;
  search?: string;
  shopDomain?: string;
  status?: string;
  to?: string;
}
const MODULES = [
  "IMPORT_EXPORT",
  "NOTIFICATIONS",
  "SETTINGS",
  "ORDERS",
  "FULFILLMENTS",
];
const STATUSES = [
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
  "CANCELLED",
];
const dateInput = (value?: string) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
export function LogFilters({
  onSubmit,
  initialValues = {},
  modules = [],
  featureKeys = [],
}: {
  onSubmit: (filters: LogFilterValues) => void;
  initialValues?: LogFilterValues;
  modules?: string[];
  featureKeys?: string[];
}) {
  const [values, setValues] = useState({
    actorId: initialValues.actorId ?? "",
    featureKey: initialValues.featureKey ?? "",
    from: dateInput(initialValues.from),
    module: initialValues.module ?? "",
    search: initialValues.search ?? "",
    shopDomain: initialValues.shopDomain ?? "",
    status: initialValues.status ?? "",
    to: dateInput(initialValues.to),
  });
  const [advanced, setAdvanced] = useState(
    Boolean(initialValues.actorId || initialValues.from || initialValues.to)
  );
  const update = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(
          Object.fromEntries(
            Object.entries(values)
              .filter(([, value]) => value.trim())
              .map(([key, value]) => [
                key,
                key === "from" || key === "to"
                  ? new Date(value).toISOString()
                  : value.trim(),
              ])
          )
        );
      }}
    >
      <div className="grid items-end gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(220px,1.5fr)_repeat(4,minmax(130px,1fr))_auto]">
        <TextField
          id="workflow-search"
          label="Search"
          onChange={(event) => update("search", event.target.value)}
          placeholder="Run, batch, order, shop, error…"
          value={values.search}
        />
        <ChoiceSelect
          choices={[
            { label: "All modules", value: "all" },
            ...Array.from(new Set([...MODULES, ...modules]))
              .sort()
              .map((value) => ({ label: formatLogLabel(value), value })),
          ]}
          id="workflow-module"
          label="Module"
          onValueChange={(value) =>
            update("module", value === "all" ? "" : value)
          }
          value={values.module || "all"}
        />
        <ChoiceSelect
          choices={[
            { label: "All statuses", value: "all" },
            ...STATUSES.map((value) => ({
              label: formatLogLabel(value),
              value,
            })),
          ]}
          id="workflow-status"
          label="Status"
          onValueChange={(value) =>
            update("status", value === "all" ? "" : value)
          }
          value={values.status || "all"}
        />
        <div>
          <TextField
            id="workflow-feature"
            label="Feature key"
            list="workflow-features"
            onChange={(event) => update("featureKey", event.target.value)}
            placeholder="All features"
            value={values.featureKey}
          />
          <datalist id="workflow-features">
            {featureKeys.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>
        <TextField
          id="workflow-shop"
          label="Shop domain"
          onChange={(event) => update("shopDomain", event.target.value)}
          placeholder="All shops"
          value={values.shopDomain}
        />
        <Button type="submit">
          <Search />
          Search
        </Button>
      </div>
      <Collapsible onOpenChange={setAdvanced} open={advanced}>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAdvanced((open) => !open)}
            size="xs"
            type="button"
            variant="ghost"
          >
            Advanced filters
            <ChevronDown
              className={
                advanced
                  ? "rotate-180 transition-transform"
                  : "transition-transform"
              }
            />
          </Button>
          <Button
            onClick={() => {
              setValues({
                actorId: "",
                featureKey: "",
                from: "",
                module: "",
                search: "",
                shopDomain: "",
                status: "",
                to: "",
              });
              onSubmit({});
            }}
            size="xs"
            type="button"
            variant="ghost"
          >
            Reset filters
          </Button>
        </div>
        <CollapsibleContent>
          <div className="grid gap-3 pt-3 sm:grid-cols-3">
            <TextField
              id="workflow-actor"
              label="Actor ID"
              onChange={(event) => update("actorId", event.target.value)}
              value={values.actorId}
            />
            <TextField
              id="workflow-from"
              label="From"
              onChange={(event) => update("from", event.target.value)}
              type="datetime-local"
              value={values.from}
            />
            <TextField
              id="workflow-to"
              label="To"
              min={values.from || undefined}
              onChange={(event) => update("to", event.target.value)}
              type="datetime-local"
              value={values.to}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </form>
  );
}
