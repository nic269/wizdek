import { z } from "zod";
export const capabilitySchema = z.enum([
  "read",
  "profiles:edit",
  "settings:write",
  "commands",
  "secrets:reveal",
]);
export type Capability = z.infer<typeof capabilitySchema>;
export const safetySchema = z.enum(["staging", "production", "custom"]);
export type SafetyClass = z.infer<typeof safetySchema>;
export interface Actor {
  email: string;
  id: string;
  name: string;
}
export interface PublicProfile {
  capabilities: Capability[];
  databaseLabel: string;
  enabled: boolean;
  hasApi: boolean;
  id: string;
  name: string;
  preset: "staging" | "production" | null;
  revision: number;
  safetyClass: SafetyClass;
  updatedAt: string;
  writable: boolean;
}
export const identitySchema = z.object({
  expiresAt: z.string().datetime(),
  user: z.object({
    email: z.string(),
    id: z.string().min(1),
    name: z.string(),
  }),
});
export const targetSchema = z.object({
  profileId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  revision: z.number().int().positive(),
});
export type TargetRef = z.infer<typeof targetSchema>;
export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  exceptions: z.array(z.string()).max(100),
});
export type Maintenance = z.infer<typeof maintenanceSchema>;
export function queryKey(
  actorId: string,
  target: TargetRef,
  accountScope: string,
  resource: string,
  filters: unknown = {}
) {
  return [
    "oms",
    actorId,
    target.profileId,
    target.revision,
    accountScope,
    resource,
    filters,
  ] as const;
}
