"use client";

import { Button } from "@repo/design-system";
import { TemplateInput } from "../template-input";
import {
  asArray,
  asString,
  type ConfigFormProps,
  Field,
  removeAt,
  replaceAt,
} from "./form-parts";

export function AddTagsForm({
  config,
  disabled,
  onChange,
  sampleFields,
}: ConfigFormProps) {
  const tags = asArray<string>(config.tags);
  const setTags = (next: string[]) => onChange({ ...config, tags: next });

  return (
    <div className="space-y-4">
      <Field
        hint="The order, customer, product or draft order to tag."
        label="Resource"
      >
        <TemplateInput
          disabled={disabled}
          label="Resource"
          onChange={(resourceId) => onChange({ ...config, resourceId })}
          placeholder="{{ $json.order.id }}"
          sampleFields={sampleFields}
          value={asString(config.resourceId)}
        />
      </Field>
      <Field
        hint="Tags the resource already has are left as they are."
        label="Tags to add"
      >
        <div className="space-y-2">
          {tags.map((tag, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            <div className="flex items-start gap-2" key={index}>
              <div className="flex-1">
                <TemplateInput
                  disabled={disabled}
                  label={`Tag ${index + 1}`}
                  onChange={(value) => setTags(replaceAt(tags, index, value))}
                  placeholder="high-value"
                  value={tag}
                />
              </div>
              <Button
                aria-label={`Remove tag ${index + 1}`}
                disabled={disabled}
                onClick={() => setTags(removeAt(tags, index))}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            disabled={disabled}
            onClick={() => setTags([...tags, ""])}
            size="sm"
            type="button"
            variant="outline"
          >
            Add tag
          </Button>
        </div>
      </Field>
    </div>
  );
}
