"use client";

import { Input } from "@repo/design-system";
import {
  asString,
  type ConfigFormProps,
  Field,
  selectClassName,
} from "./form-parts";

const PRESETS = [
  { cron: "0 * * * *", label: "Every hour" },
  { cron: "0 6 * * *", label: "Every day at 06:00" },
  { cron: "0 9 * * 1", label: "Every Monday at 09:00" },
  { cron: "0 0 1 * *", label: "On the first day of each month" },
];

export function TriggerScheduleForm({
  config,
  disabled,
  onChange,
}: ConfigFormProps) {
  const cron = asString(config.cron);
  const isPreset = PRESETS.some((preset) => preset.cron === cron);

  return (
    <div className="space-y-4">
      <Field label="Run">
        <select
          aria-label="Schedule preset"
          className={selectClassName}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) {
              onChange({ ...config, cron: event.target.value });
            }
          }}
          value={isPreset ? cron : ""}
        >
          <option value="">Custom schedule</option>
          {PRESETS.map((preset) => (
            <option key={preset.cron} value={preset.cron}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        hint="Five fields: minute, hour, day of month, month, day of week. A schedule fires at most once a minute."
        label="Cron expression"
      >
        <Input
          aria-label="Cron expression"
          className="font-mono"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, cron: event.target.value })
          }
          placeholder="0 6 * * *"
          value={cron}
        />
      </Field>
      <Field
        hint="A time zone name such as Asia/Ho_Chi_Minh. The schedule follows this zone's clock."
        label="Time zone"
      >
        <Input
          aria-label="Time zone"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, timezone: event.target.value })
          }
          placeholder="UTC"
          value={asString(config.timezone, "UTC")}
        />
      </Field>
    </div>
  );
}
