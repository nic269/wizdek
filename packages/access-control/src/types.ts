import type { PERMISSION_CATALOG } from "./catalog";

export type PermissionDefinition = (typeof PERMISSION_CATALOG)[number];
export type PermissionAction = PermissionDefinition["action"];
export type PermissionModule = PermissionDefinition["module"];
export type PermissionKey = PermissionDefinition extends infer TPermission
  ? TPermission extends { action: infer TAction; module: infer TModule }
    ? TAction extends string
      ? TModule extends string
        ? `${TModule}:${TAction}`
        : never
      : never
    : never
  : never;

export interface PermissionInput {
  action: string;
  module: string;
}

export type KnownPermission = PermissionDefinition extends infer TPermission
  ? TPermission extends { action: infer TAction; module: infer TModule }
    ? TAction extends PermissionAction
      ? TModule extends PermissionModule
        ? { action: TAction; module: TModule }
        : never
      : never
    : never
  : never;
