"use client";

import { Button, Input } from "@repo/design-system";

const SIMPLE_NAME = /^[A-Za-z_$][\w$]*$/;

/** The template that reads one field of the current item. */
export const fieldTemplate = (field: string) =>
  SIMPLE_NAME.test(field)
    ? `{{ $json.${field} }}`
    : `{{ $json[${JSON.stringify(field)}] }}`;

/**
 * A text input for values that may contain templates. When a previous run
 * left sample data at the node, its field names are offered as shortcuts.
 */
export function TemplateInput({
  disabled,
  label,
  onChange,
  placeholder,
  sampleFields = [],
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  sampleFields?: readonly string[];
  value: string;
}) {
  return (
    <div className="space-y-1">
      <Input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? "{{ $json.field }}"}
        value={value}
      />
      {disabled || sampleFields.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {sampleFields.map((field) => (
            <Button
              className="h-auto px-1.5 py-0.5 font-mono font-normal text-[10px]"
              key={field}
              onClick={() => onChange(`${value}${fieldTemplate(field)}`)}
              size="xs"
              title={`Insert ${fieldTemplate(field)}`}
              type="button"
              variant="secondary"
            >
              {field}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplateHelp() {
  return (
    <p className="text-muted-foreground text-xs">
      Use <code className="font-mono">{"{{ $json.field }}"}</code> to read a
      field of the item, or{" "}
      <code className="font-mono">{'{{ $json["Field name"] }}'}</code> when the
      name has spaces. <code className="font-mono">$trigger</code> holds the
      values the run was started with.
    </p>
  );
}
