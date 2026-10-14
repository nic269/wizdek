"use client";

import { Button, cn, X } from "@repo/design-system";
import { Input } from "@repo/design-system/components/ui/input";
import { type KeyboardEvent, useState } from "react";
import { TemplateInput } from "../template-input";
import { asArray, asString, type ConfigFormProps, Field } from "./form-parts";

const TAG_SEPARATOR = /,/;

export function AddTagsForm({ config, disabled, onChange }: ConfigFormProps) {
  const tags = asArray<string>(config.tags);
  const [draft, setDraft] = useState("");
  const setTags = (next: string[]) => onChange({ ...config, tags: next });
  const missing = tags.length === 0;

  const commit = () => {
    const added = draft
      .split(TAG_SEPARATOR)
      .map((tag) => tag.trim())
      .filter((tag) => tag && !tags.includes(tag));
    if (added.length > 0) {
      setTags([...tags, ...added]);
    }
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Backspace" && !draft && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        hint="The order, customer, product or draft order to tag, by its id."
        label="Resource"
      >
        <TemplateInput
          disabled={disabled}
          label="Resource"
          onChange={(resourceId) => onChange({ ...config, resourceId })}
          placeholder="{{ $json.order.id }}"
          value={asString(config.resourceId)}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-[12.5px]" id="add-tags-label">
          Tags <span className="text-(--status-danger-fg)">*</span>
        </span>
        <fieldset
          aria-labelledby="add-tags-label"
          className={cn(
            "m-0 flex min-h-[34px] min-w-0 flex-wrap items-center gap-[5px] rounded-lg border bg-card px-2 py-1",
            missing
              ? "border-[#e8c77c] shadow-[0_0_0_3px_#fdf3dc]"
              : "border-input focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft",
            disabled && "bg-sunken"
          )}
        >
          {tags.map((tag) => (
            <span
              className="inline-flex items-center gap-[5px] rounded border border-border bg-sunken px-1.5 py-1 font-medium text-xs leading-none"
              key={tag}
            >
              {tag}
              {disabled ? null : (
                <Button
                  aria-label={`Remove tag ${tag}`}
                  className="size-3.5 rounded-sm p-0 text-muted-foreground"
                  onClick={() =>
                    setTags(tags.filter((current) => current !== tag))
                  }
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-2.5" />
                </Button>
              )}
            </span>
          ))}
          {disabled ? null : (
            <Input
              aria-describedby="add-tags-help"
              aria-invalid={missing ? true : undefined}
              aria-label="Add a tag"
              className="h-6 min-w-[90px] flex-1 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 aria-invalid:ring-0"
              onBlur={commit}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={missing ? "vip, high-value…" : ""}
              value={draft}
            />
          )}
        </fieldset>
        {missing ? (
          <span className="text-(--status-danger-fg) text-xs leading-[1.4]">
            At least one tag is required. Press Enter to add.
          </span>
        ) : null}
        <span
          className="text-muted-foreground text-xs leading-[1.4]"
          id="add-tags-help"
        >
          Tags already on the resource are left unchanged.
        </span>
      </div>
    </div>
  );
}
