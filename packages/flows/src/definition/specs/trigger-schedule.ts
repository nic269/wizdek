import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

const CRON_FIELD = /^[\d*/,\-A-Za-z?#LW]+$/;
const WHITESPACE = /\s+/;

/** Five fields: minute, hour, day of month, month, day of week. */
export const isCronExpression = (value: string): boolean => {
  const fields = value.trim().split(WHITESPACE);
  return fields.length === 5 && fields.every((field) => CRON_FIELD.test(field));
};

export const isTimeZone = (value: string): boolean => {
  try {
    return Boolean(new Intl.DateTimeFormat("en", { timeZone: value }));
  } catch {
    return false;
  }
};

export const triggerScheduleSpec = defineNodeSpec({
  category: "trigger",
  configSchema: z.object({
    cron: z
      .string()
      .refine(
        isCronExpression,
        "Use five cron fields, such as 0 6 * * * for every day at 06:00."
      ),
    timezone: z
      .string()
      .default("UTC")
      .refine(isTimeZone, "Use a time zone name such as Asia/Ho_Chi_Minh."),
  }),
  description:
    "Starts the flow on a schedule. The item holds the time the run was scheduled for.",
  idempotent: true,
  label: "Schedule",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "trigger.schedule",
});
