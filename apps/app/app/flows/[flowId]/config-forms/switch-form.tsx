"use client";

import { Button, Input } from "@repo/design-system";
import { TemplateInput } from "../template-input";
import {
  asArray,
  asString,
  type ConfigFormProps,
  Field,
  removeAt,
  replaceAt,
} from "./form-parts";

interface SwitchCase {
  name: string;
  value: string;
}

export function SwitchForm({ config, disabled, onChange }: ConfigFormProps) {
  const cases = asArray<SwitchCase>(config.cases);
  const setCases = (next: SwitchCase[]) => onChange({ ...config, cases: next });

  return (
    <div className="space-y-4">
      <Field label="Value to route by">
        <TemplateInput
          disabled={disabled}
          label="Switch value"
          onChange={(value) => onChange({ ...config, value })}
          placeholder="{{ $json.country }}"
          value={asString(config.value)}
        />
      </Field>
      <Field
        hint="Each case is an output of this step. Items that match no case leave by “default”."
        label="Cases"
      >
        <div className="space-y-2">
          {cases.map((entry, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            <div className="space-y-1 rounded-md border p-2" key={index}>
              <Input
                aria-label={`Case ${index + 1} name`}
                disabled={disabled}
                onChange={(event) =>
                  setCases(
                    replaceAt(cases, index, {
                      ...entry,
                      name: event.target.value,
                    })
                  )
                }
                placeholder="Output name, such as vietnam"
                value={entry.name}
              />
              <TemplateInput
                disabled={disabled}
                label={`Case ${index + 1} equals`}
                onChange={(value) =>
                  setCases(replaceAt(cases, index, { ...entry, value }))
                }
                placeholder="VN"
                value={entry.value}
              />
              <Button
                disabled={disabled}
                onClick={() => setCases(removeAt(cases, index))}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove case
              </Button>
            </div>
          ))}
          <Button
            disabled={disabled}
            onClick={() => setCases([...cases, { name: "", value: "" }])}
            size="sm"
            type="button"
            variant="outline"
          >
            Add case
          </Button>
        </div>
      </Field>
    </div>
  );
}
