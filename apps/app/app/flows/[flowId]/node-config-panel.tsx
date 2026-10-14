"use client";

import { apiClient } from "@repo/api/client";
import {
  Button,
  InlineAlert,
  Input,
  Trash2,
  toast,
  X,
} from "@repo/design-system";
import type { FlowIssue } from "@repo/flows/definition";
import { type ComponentType, useEffect, useState } from "react";
import { asCategory, CategoryChip } from "../node-visuals";
import { AddTagsForm } from "./config-forms/add-tags-form";
import { FindOrderForm } from "./config-forms/find-order-form";
import { type ConfigFormProps, Field } from "./config-forms/form-parts";
import { GenericForm } from "./config-forms/generic-form";
import { FilterForm, IfForm } from "./config-forms/if-form";
import { ParseCsvForm } from "./config-forms/parse-csv-form";
import { ShopifyGraphqlForm } from "./config-forms/shopify-graphql-form";
import { SwitchForm } from "./config-forms/switch-form";
import { TriggerManualForm } from "./config-forms/trigger-manual-form";
import { TriggerScheduleForm } from "./config-forms/trigger-schedule-form";
import { TriggerWebhookForm } from "./config-forms/trigger-webhook-form";
import type { CanvasNode } from "./flow-definition-mapping";
import { fieldTemplate, TemplateHelp } from "./template-input";
import type { NodeType } from "./use-flow-editor";
import { issueText } from "./validation-panel";

/** Node types with a hand-made form; every other type gets the generic one. */
const BESPOKE_FORMS: Record<string, ComponentType<ConfigFormProps>> = {
  "data.parseCsv": ParseCsvForm,
  "logic.filter": FilterForm,
  "logic.if": IfForm,
  "logic.switch": SwitchForm,
  "shopify.addTags": AddTagsForm,
  "shopify.findOrder": FindOrderForm,
  "shopify.graphql": ShopifyGraphqlForm,
  "trigger.manual": TriggerManualForm,
  "trigger.schedule": TriggerScheduleForm,
  "trigger.webhook": TriggerWebhookForm,
};

/**
 * Field names of the last item this node received in the flow's latest run.
 * Empty until the flow has run; templates are then typed by hand.
 */
const useSampleFields = (flowId: string, nodeId: string): string[] => {
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    let isCurrent = true;
    setFields([]);
    (async () => {
      const runs = await apiClient.flows.runs.list({ flowId, limit: 1 });
      const runId = runs.data[0]?.id;
      if (!runId) {
        return;
      }
      const items = await apiClient.flows.runs.items.list({
        limit: 1,
        nodeId,
        runId,
      });
      const input = items.data[0]?.input;
      if (isCurrent && input && typeof input === "object") {
        setFields(Object.keys(input).filter((key) => !key.startsWith("$")));
      }
    })().catch(() => {
      // Sample fields are a convenience; the form works without them.
    });
    return () => {
      isCurrent = false;
    };
  }, [flowId, nodeId]);
  return fields;
};

const Kbd = ({ children }: { children: string }) => (
  <kbd className="rounded border border-border px-[5px] py-[3px] font-medium font-mono text-[10.5px] text-foreground leading-none">
    {children}
  </kbd>
);

/** What the settings panel shows while no step is selected. */
export function NothingSelected({ canManage }: { canManage: boolean }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-6 text-[13px] text-muted-foreground leading-[1.55]">
      <h2 className="font-semibold text-foreground text-sm leading-[1.3]">
        Nothing selected
      </h2>
      <p>
        {canManage
          ? "Select a step to configure it. Add steps from the palette, and connect them by dragging from one handle to another."
          : "Select a step to see how it is configured."}
      </p>
      {canManage ? (
        <div className="mt-1.5 flex flex-col gap-1.5 text-[12.5px]">
          <span className="flex items-center gap-2">
            <Kbd>⌘S</Kbd>Save a new version
          </span>
          <span className="flex items-center gap-2">
            <Kbd>⌫</Kbd>Delete selected step
          </span>
        </div>
      ) : null}
    </div>
  );
}

const copyTemplate = async (field: string) => {
  const template = fieldTemplate(field);
  try {
    await navigator.clipboard.writeText(template);
    toast.success("Copied", { description: template });
  } catch {
    toast.error("Could not copy", { description: template });
  }
};

export function NodeConfigPanel({
  canManage,
  flowId,
  issues,
  node,
  nodeType,
  onChange,
  onClose,
  onRemove,
}: {
  canManage: boolean;
  flowId: string;
  issues: FlowIssue[];
  node: CanvasNode;
  nodeType: NodeType | undefined;
  onChange: (patch: {
    config?: Record<string, unknown>;
    name?: string;
  }) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const sampleFields = useSampleFields(flowId, node.id);
  const Form = BESPOKE_FORMS[node.data.nodeType];
  const category = asCategory(nodeType?.category);
  const formProps: ConfigFormProps = {
    config: node.data.config,
    disabled: !canManage,
    onChange: (config) => onChange({ config }),
  };

  return (
    <aside
      aria-label="Step settings"
      className="flex min-h-0 flex-1 flex-col"
      data-testid="node-config-panel"
    >
      <div className="flex items-center gap-2.5 border-border border-b px-4 py-3.5">
        <CategoryChip
          category={category}
          nodeType={node.data.nodeType}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-[14.5px] leading-[1.25]">
            {node.data.name || nodeType?.label || node.data.nodeType}
          </h2>
          <p className="line-clamp-2 text-muted-foreground text-xs leading-[1.3]">
            {nodeType?.description}
          </p>
        </div>
        <Button
          aria-label="Close step settings"
          className="text-muted-foreground"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X className="size-[15px]" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Field label="Step name">
          <Input
            aria-label="Step name"
            disabled={!canManage}
            maxLength={120}
            onChange={(event) => onChange({ name: event.target.value })}
            value={node.data.name}
          />
        </Field>
        {Form ? (
          <Form {...formProps} />
        ) : (
          <GenericForm {...formProps} schema={nodeType?.configSchema} />
        )}
        {issues.length > 0 ? (
          <InlineAlert tone="warning">
            <ul className="flex flex-col gap-0.5">
              {issues.map((issue) => (
                <li key={`${issue.code}-${issue.path ?? ""}-${issue.message}`}>
                  {issueText(issue)}
                </li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}
        <div className="flex flex-col gap-2 border-border border-t pt-3.5">
          <div className="flex items-center gap-1.5">
            <span className="flex-1 font-medium text-[12.5px]">
              Fields from previous steps
            </span>
            {sampleFields.length > 0 ? (
              <span className="text-[11.5px] text-muted-foreground">
                click to copy
              </span>
            ) : null}
          </div>
          {sampleFields.length > 0 ? (
            <div className="flex flex-wrap gap-[5px]">
              {sampleFields.map((field) => (
                <Button
                  className="h-auto rounded px-[7px] py-[5px] font-medium font-mono text-[11.5px] text-foreground-2 hover:border-accent hover:bg-card hover:text-accent-ink"
                  key={field}
                  onClick={() => copyTemplate(field)}
                  title={`Copy ${fieldTemplate(field)}`}
                  type="button"
                  variant="outline"
                >
                  {fieldTemplate(field)}
                </Button>
              ))}
            </div>
          ) : (
            <TemplateHelp />
          )}
        </div>
        {canManage ? (
          <Button
            className="self-start"
            onClick={onRemove}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2 />
            Delete step
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
