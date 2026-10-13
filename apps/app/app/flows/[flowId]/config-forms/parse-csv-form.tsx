"use client";

import { TemplateInput } from "../template-input";
import {
  asString,
  Checkbox,
  type ConfigFormProps,
  Field,
  selectClassName,
} from "./form-parts";

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
        <select
          aria-label="Delimiter"
          className={selectClassName}
          disabled={disabled}
          onChange={(event) => set({ delimiter: event.target.value })}
          value={asString(config.delimiter, ",")}
        >
          <option value=",">Comma</option>
          <option value=";">Semicolon</option>
          <option value={"\t"}>Tab</option>
          <option value="|">Pipe</option>
        </select>
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
