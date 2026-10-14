"use client";

import { cn, Input } from "@repo/design-system";
import { useState } from "react";

const SIMPLE_NAME = /^[A-Za-z_$][\w$]*$/;
const TEMPLATE_PART = /(\{\{[\s\S]*?\}\})/;

/** The template that reads one field of the current item. */
export const fieldTemplate = (field: string) =>
  SIMPLE_NAME.test(field)
    ? `{{ $json.${field} }}`
    : `{{ $json[${JSON.stringify(field)}] }}`;

/** Splits text into plain parts and `{{ … }}` template parts, keyed by offset. */
const splitTemplate = (value: string) => {
  let offset = 0;
  return value
    .split(TEMPLATE_PART)
    .filter(Boolean)
    .map((text) => {
      const part = {
        key: `at-${offset}`,
        template: TEMPLATE_PART.test(text),
        text,
      };
      offset += text.length;
      return part;
    });
};

/**
 * A text input for values that may contain templates. At rest, templates
 * show as mono pills; focusing the field edits the raw text.
 */
export function TemplateInput({
  className,
  disabled,
  label,
  onChange,
  placeholder,
  value,
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [focused, setFocused] = useState(false);
  const parts = splitTemplate(value);
  const showPills = !focused && parts.some(({ template }) => template);
  return (
    <div className={cn("relative", className)}>
      <Input
        aria-label={label}
        className={cn(
          "font-mono text-[12.5px]",
          showPills && "text-transparent caret-transparent"
        )}
        disabled={disabled}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder ?? "{{ $json.field }}"}
        spellCheck={false}
        value={value}
      />
      {showPills ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2.5 left-2 flex items-center gap-1 overflow-hidden whitespace-pre"
        >
          {parts.map((part) =>
            part.template ? (
              <span
                className="shrink-0 rounded bg-accent-soft px-1.5 py-1 font-medium font-mono text-[12px] text-accent-ink leading-none"
                key={part.key}
              >
                {part.text}
              </span>
            ) : (
              <span
                className="font-mono text-[12.5px] text-foreground"
                key={part.key}
              >
                {part.text}
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TemplateHelp() {
  return (
    <p className="text-muted-foreground text-xs leading-[1.45]">
      Use <code className="font-mono">{"{{ $json.field }}"}</code> to read a
      field of the item, or{" "}
      <code className="font-mono">{'{{ $json["Field name"] }}'}</code> when the
      name has spaces. <code className="font-mono">$trigger</code> holds the
      values the run was started with. Field names appear here once the flow has
      run.
    </p>
  );
}
