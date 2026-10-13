"use client";

import { apiClient } from "@repo/api/client";
import { Button, Input } from "@repo/design-system";
import type { FlowIssue } from "@repo/flows/definition";
import { type ComponentType, useEffect, useState } from "react";
import { AddTagsForm } from "./config-forms/add-tags-form";
import { FindOrderForm } from "./config-forms/find-order-form";
import type { ConfigFormProps } from "./config-forms/form-parts";
import { GenericForm } from "./config-forms/generic-form";
import { IfForm } from "./config-forms/if-form";
import { ParseCsvForm } from "./config-forms/parse-csv-form";
import { TriggerManualForm } from "./config-forms/trigger-manual-form";
import type { CanvasNode } from "./flow-definition-mapping";
import { TemplateHelp } from "./template-input";
import type { NodeType } from "./use-flow-editor";

/** Node types with a hand-made form; every other type gets the generic one. */
const BESPOKE_FORMS: Record<string, ComponentType<ConfigFormProps>> = {
  "data.parseCsv": ParseCsvForm,
  "logic.if": IfForm,
  "shopify.addTags": AddTagsForm,
  "shopify.findOrder": FindOrderForm,
  "trigger.manual": TriggerManualForm,
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

export function NodeConfigPanel({
  canManage,
  flowId,
  issues,
  node,
  nodeType,
  onChange,
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
  onRemove: () => void;
}) {
  const sampleFields = useSampleFields(flowId, node.id);
  const Form = BESPOKE_FORMS[node.data.nodeType];
  const formProps: ConfigFormProps = {
    config: node.data.config,
    disabled: !canManage,
    onChange: (config) => onChange({ config }),
    sampleFields,
  };

  return (
    <aside
      aria-label="Step settings"
      className="space-y-4 overflow-y-auto p-4"
      data-testid="node-config-panel"
    >
      <div>
        <h2 className="font-semibold text-base">
          {nodeType?.label ?? node.data.nodeType}
        </h2>
        <p className="text-muted-foreground text-xs">{nodeType?.description}</p>
      </div>
      <div className="space-y-1">
        <p className="font-medium text-sm">Name</p>
        <Input
          aria-label="Step name"
          disabled={!canManage}
          maxLength={120}
          onChange={(event) => onChange({ name: event.target.value })}
          value={node.data.name}
        />
      </div>
      {Form ? (
        <Form {...formProps} />
      ) : (
        <GenericForm {...formProps} schema={nodeType?.configSchema} />
      )}
      {issues.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs">
          {issues.map((issue) => (
            <li key={`${issue.code}-${issue.path ?? ""}-${issue.message}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <TemplateHelp />
      {canManage ? (
        <Button onClick={onRemove} size="sm" type="button" variant="ghost">
          Delete step
        </Button>
      ) : null}
    </aside>
  );
}
