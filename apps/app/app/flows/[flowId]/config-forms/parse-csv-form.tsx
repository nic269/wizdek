"use client";

import { OptionSelect } from "../../../lib/option-select";
import { TemplateInput } from "../template-input";
import { asString, Checkbox, type ConfigFormProps, Field } from "./form-parts";

const DELIMITER_OPTIONS = [
  { label: "Comma", value: "," },
  { label: "Semicolon", value: ";" },
  { label: "Tab", value: "\t" },
  { label: "Pipe", value: "|" },
];

export function ParseCsvForm({
  config,
  disabled,
  onChange,
  sampleFields,
}: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...config, ...patch });

  return (
    <div className="space-y-4">
      <Field
        hint="A template that resolves to an uploaded file, usually a file input of the trigger."
        label="File"
      >
        <TemplateInput
          disabled={disabled}
          label="File"
          onChange={(file) => set({ file })}
          placeholder="{{ $json.csvFile }}"
          sampleFields={sampleFields}
          value={asString(config.file)}
        />
      </Field>
      <Field label="Delimiter">
        <OptionSelect
          aria-label="Delimiter"
          disabled={disabled}
          onValueChange={(delimiter) => set({ delimiter })}
          options={DELIMITER_OPTIONS}
          value={asString(config.delimiter, ",")}
        />
      </Field>
      <div className="space-y-2">
        <Checkbox
          checked={config.hasHeader !== false}
          disabled={disabled}
          label="First row holds the column names"
          onChange={(hasHeader) => set({ hasHeader })}
        />
        <Checkbox
          checked={config.trimValues !== false}
          disabled={disabled}
          label="Trim spaces around values"
          onChange={(trimValues) => set({ trimValues })}
        />
        <Checkbox
          checked={config.skipEmptyRows !== false}
          disabled={disabled}
          label="Skip empty rows"
          onChange={(skipEmptyRows) => set({ skipEmptyRows })}
        />
      </div>
    </div>
  );
}
