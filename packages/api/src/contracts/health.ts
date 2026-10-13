import { z } from "zod";
import { apiContract, emptyInputSchema } from "./base";

export const okSchema = z.object({ ok: z.literal(true) });
const readinessCheckSchema = z.object({
  healthy: z.boolean(),
  latencyMs: z.number().nonnegative(),
  message: z.string().optional(),
});
const providerStatusSchema = z.object({
  configured: z.boolean(),
  healthy: z.boolean(),
  message: z.string().optional(),
  mode: z.string(),
  provider: z.string(),
  required: z.boolean(),
  state: z.enum(["configured", "disabled", "misconfigured"]),
});
export const readySchema = z.object({
  checks: z.object({
    database: readinessCheckSchema,
  }),
  ok: z.literal(true),
  providers: z.object({
    jobs: providerStatusSchema,
    mail: providerStatusSchema,
    storage: providerStatusSchema,
  }),
});
export const statusSchema = z.object({
  ok: z.literal(true),
  service: z.literal("api"),
  time: z.iso.datetime(),
});

const health = apiContract
  .route({
    method: "GET",
    operationId: "health.get.rest",
    path: "/health",
    summary: "Health check",
  })
  .input(emptyInputSchema)
  .output(okSchema);

const ready = apiContract
  .route({
    method: "GET",
    operationId: "ready.get.rest",
    path: "/ready",
    summary: "Readiness check",
  })
  .input(emptyInputSchema)
  .output(readySchema);

const status = apiContract
  .route({
    method: "GET",
    operationId: "status.get.rest",
    path: "/status",
    summary: "Service status",
  })
  .input(emptyInputSchema)
  .output(statusSchema);

export const healthContract = { health, ready, status };
