"use client";

import { Input } from "@repo/design-system";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { mayMutate } from "@repo/flows/definition";
import { asString, type ConfigFormProps, Field } from "./form-parts";

export function ShopifyGraphqlForm({
  config,
  disabled,
  onChange,
}: ConfigFormProps) {
  const document = asString(config.document);

  return (
    <div className="space-y-4">
      <Field
        hint="One Admin GraphQL query or mutation. Write and try it in the GraphQL console first."
        label="Document"
      >
        <Textarea
          aria-label="GraphQL document"
          className="font-mono text-xs"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, document: event.target.value })
          }
          placeholder={"query ($id: ID!) {\n  order(id: $id) { id note }\n}"}
          rows={8}
          value={document}
        />
      </Field>
      {mayMutate(document) ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          This changes store data for every item. If a run is interrupted while
          an item is being sent, that item is marked Unknown and is not sent
          again.
        </p>
      ) : null}
      <Field
        hint='A JSON object. Text values may contain templates, such as "{{ $json.order.id }}".'
        label="Variables"
      >
        <Textarea
          aria-label="GraphQL variables"
          className="font-mono text-xs"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, variables: event.target.value })
          }
          placeholder={'{ "id": "{{ $json.order.id }}" }'}
          rows={5}
          value={asString(config.variables, "{}")}
        />
      </Field>
      <Field
        hint="Where to read the result from in the response, such as orderUpdate.order. Empty keeps everything. It is added to the item as result."
        label="Result path"
      >
        <Input
          aria-label="Result path"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, resultPath: event.target.value })
          }
          placeholder="orderUpdate.order"
          value={asString(config.resultPath)}
        />
      </Field>
    </div>
  );
}
