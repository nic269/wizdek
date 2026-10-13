"use client";

import { Button, Input } from "@repo/design-system";
import {
  asArray,
  type ConfigFormProps,
  Field,
  removeAt,
  replaceAt,
  selectClassName,
} from "./form-parts";

interface ManualInput {
  key: string;
  label: string;
  type: "file" | "text" | "number";
}

export function TriggerManualForm({
  config,
  disabled,
  onChange,
}: ConfigFormProps) {
  const inputs = asArray<ManualInput>(config.inputs);
  const setInputs = (next: ManualInput[]) =>
    onChange({ ...config, inputs: next });

  return (
    <Field
      hint="Each input is asked for when someone runs the flow, and is available as {{ $json.key }}."
      label="Run inputs"
    >
      <div className="space-y-2">
        {inputs.map((input, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
          <div className="space-y-1 rounded-md border p-2" key={index}>
            <Input
              aria-label={`Input ${index + 1} label`}
              disabled={disabled}
              onChange={(event) =>
                setInputs(
                  replaceAt(inputs, index, {
                    ...input,
                    label: event.target.value,
                  })
                )
              }
              placeholder="Label, such as CSV file"
              value={input.label}
            />
            <div className="flex gap-2">
              <Input
                aria-label={`Input ${index + 1} key`}
                disabled={disabled}
                onChange={(event) =>
                  setInputs(
                    replaceAt(inputs, index, {
                      ...input,
                      key: event.target.value,
                    })
                  )
                }
                placeholder="key, such as csvFile"
                value={input.key}
              />
              <select
                aria-label={`Input ${index + 1} type`}
                className={selectClassName}
                disabled={disabled}
                onChange={(event) =>
                  setInputs(
                    replaceAt(inputs, index, {
                      ...input,
                      type: event.target.value as ManualInput["type"],
                    })
                  )
                }
                value={input.type}
              >
                <option value="file">CSV file</option>
                <option value="text">Text</option>
                <option value="number">Number</option>
              </select>
              <Button
                aria-label={`Remove input ${index + 1}`}
                disabled={disabled}
                onClick={() => setInputs(removeAt(inputs, index))}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button
          disabled={disabled}
          onClick={() =>
            setInputs([...inputs, { key: "", label: "", type: "file" }])
          }
          size="sm"
          type="button"
          variant="outline"
        >
          Add input
        </Button>
      </div>
    </Field>
  );
}
