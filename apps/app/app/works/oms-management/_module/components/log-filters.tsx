"use client";

import { Button, Filter, Input, Search } from "@repo/design-system";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { type ReactNode, useState } from "react";
import { type Choice, TextField } from "./oms-ui";
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
  trailing,
}: {
  /** Controls at the end of the bar, such as the auto-refresh switch. */
  trailing?: ReactNode;
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
    Boolean(
      initialValues.shopDomain ||
        initialValues.actorId ||
        initialValues.from ||
        initialValues.to
    )
  );
  const update = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const filterCount = [
    values.shopDomain,
    values.actorId,
    values.from,
    values.to,
  ].filter(Boolean).length;
  return (
    <form
      className="flex flex-col gap-3 border-border border-b px-5 py-3"
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[260px]">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            aria-label="Search runs"
            className="pl-8"
            onChange={(event) => update("search", event.target.value)}
            placeholder="Run, batch, order, shop, error"
            value={values.search}
          />
        </div>
        <FilterSelect
          choices={[
            { label: "All statuses", value: "all" },
            ...STATUSES.map((value) => ({
              label: formatLogLabel(value),
              value,
            })),
          ]}
          label="Status"
          onValueChange={(value) =>
            update("status", value === "all" ? "" : value)
          }
          value={values.status || "all"}
        />
        <FilterSelect
          choices={[
            { label: "All modules", value: "all" },
            ...Array.from(new Set([...MODULES, ...modules]))
              .sort()
              .map((value) => ({ label: formatLogLabel(value), value })),
          ]}
          label="Module"
          onValueChange={(value) =>
            update("module", value === "all" ? "" : value)
          }
          value={values.module || "all"}
        />
        <Input
          aria-label="Feature key"
          className="w-44"
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
        <Button
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Filter />
          Shop, actor, dates
          {filterCount > 0 ? (
            <span className="text-faint tabular-nums">· {filterCount}</span>
          ) : null}
        </Button>
        <Button
          className="text-muted-foreground"
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
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
        <Button size="sm" type="submit" variant="outline">
          Search
        </Button>
        <span className="flex-1" />
        {trailing}
      </div>
      {advanced ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TextField
            id="workflow-shop"
            label="Shop domain"
            onChange={(event) => update("shopDomain", event.target.value)}
            placeholder="All shops"
            value={values.shopDomain}
          />
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
      ) : null}
    </form>
  );
}

/** A compact filter select: no visible label, the choice names the filter. */
function FilterSelect({
  choices,
  label,
  onValueChange,
  value,
}: {
  choices: readonly Choice[];
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select
      items={choices}
      onValueChange={(next) => next !== null && onValueChange(next)}
      value={value}
    >
      <SelectTrigger aria-label={label} className="w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
