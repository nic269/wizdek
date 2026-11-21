"use client";

import { Button, ErrorAlert, InlineAlert, Play } from "@repo/design-system";
import { type ReactNode, useEffect } from "react";
import { JsonField, SchemaForm } from "../../lib/schema-form";
import type { CodeFunction } from "./use-function-editor";

type Params = Record<string, unknown>;

/** The parameters to send: only the fields `main` declares, when known. */
export const paramsToSend = (fn: CodeFunction, values: Params): Params => {
  const properties = fn.paramsSchema?.properties;
  if (!properties) {
    return values;
  }
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => key in properties && value !== undefined
    )
  );
};

/** Fills fields that have a default and no value yet. */
const withDefaults = (fn: CodeFunction, values: Params): Params | null => {
  const properties = fn.paramsSchema?.properties ?? {};
  const missing = Object.entries(properties).filter(
    ([key, property]) =>
      values[key] === undefined && property.default !== undefined
  );
  if (missing.length === 0) {
    return null;
  }
  return {
    ...values,
    ...Object.fromEntries(
      missing.map(([key, property]) => [key, property.default])
    ),
  };
};

const ParamsNotice = ({ fn }: { fn: CodeFunction }) => {
  if (fn.paramsError) {
    return (
      <InlineAlert title="Couldn't read the parameters of main." tone="warning">
        <span className="whitespace-pre-wrap font-mono text-xs">
          {fn.paramsError}
        </span>
        <span className="mt-1 block">
          You can still run it with parameters written as JSON.
        </span>
      </InlineAlert>
    );
  }
  if (fn.paramsStale) {
    return (
      <InlineAlert title="The parameters may be out of date." tone="warning">
        The runner could not read the latest source. They refresh the next time
        the files are saved while the runner answers.
      </InlineAlert>
    );
  }
  return null;
};

export function TestTab({
  canRun,
  error,
  fn,
  isBusy,
  isDirty,
  onRun,
  onValuesChange,
  packages,
  values,
}: {
  canRun: boolean;
  error: string | null;
  fn: CodeFunction;
  isBusy: boolean;
  isDirty: boolean;
  onRun: () => void;
  onValuesChange: (values: Params) => void;
  /** How the function's packages stand, shown above the form. */
  packages?: ReactNode;
  values: Params;
}) {
  const schema = fn.paramsSchema;

  useEffect(() => {
    const filled = withDefaults(fn, values);
    if (filled) {
      onValuesChange(filled);
    }
  }, [fn, onValuesChange, values]);

  const hasFields = schema && Object.keys(schema.properties).length > 0;

  return (
    <div className="space-y-4 p-4">
      {packages}
      <ParamsNotice fn={fn} />
      {schema ? null : (
        <JsonField
          disabled={!canRun}
          label="Parameters as JSON"
          onChange={(value) =>
            onValuesChange(
              value && typeof value === "object" && !Array.isArray(value)
                ? (value as Params)
                : {}
            )
          }
          rows={8}
          value={values}
        />
      )}
      {schema && hasFields ? (
        <SchemaForm
          disabled={!canRun}
          onChange={onValuesChange}
          schema={schema}
          values={values}
        />
      ) : null}
      {schema && !hasFields ? (
        <p className="text-[13px] text-muted-foreground">
          <code className="font-mono">main</code> takes no parameters.
        </p>
      ) : null}
      {error ? <ErrorAlert message={error} title="Not started." /> : null}
      {canRun ? (
        <Button
          aria-keyshortcuts="Meta+Enter"
          className="w-full"
          disabled={isBusy}
          onClick={onRun}
          type="button"
        >
          <Play className="size-[13px]" />
          {isDirty ? "Save and run" : "Run"}
          <kbd className="font-medium text-[10.5px] opacity-70">⌘↵</kbd>
        </Button>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          You need the <strong>Run functions</strong> permission to run it.
        </p>
      )}
    </div>
  );
}
