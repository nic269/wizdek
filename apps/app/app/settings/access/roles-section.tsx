"use client";

import { CUSTOM_ROLE_DEFAULT_PERMISSION_KEYS } from "@repo/access-control";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Braces,
  Building2,
  Button,
  Crown,
  cn,
  Database,
  ErrorAlert,
  Eye,
  hueFromId,
  Input,
  type LucideIcon,
  Placeholder,
  Plus,
  SectionLabel,
  Shield,
  ShieldCheck,
  Shimmer,
  Store,
  toast,
  User,
  UserCog,
  Users,
  Workflow,
} from "@repo/design-system";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import { Label } from "@repo/design-system/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { plural } from "../../lib/format";
import { peopleKeys, type Role, useRoles } from "../people";
import {
  BUILT_IN_ROLES,
  type BuiltInRole,
  PERMISSION_GROUPS,
  type PermissionGroupIcon,
  permissionsFromKeys,
  sortRoles,
} from "./access-model";

const GROUP_ICONS: Record<PermissionGroupIcon, LucideIcon> = {
  databases: Database,
  flows: Workflow,
  graphql: Braces,
  members: Users,
  organization: Building2,
  roles: Shield,
  stores: Store,
};

const ROLE_ICONS: Record<BuiltInRole["icon"], LucideIcon> = {
  admin: ShieldCheck,
  member: User,
  owner: Crown,
  viewer: Eye,
};

/** Marks the role being drafted, which has no id until it is saved. */
const DRAFT = "draft";

interface Draft {
  description: string;
  keys: Set<string>;
  name: string;
}

const newDraft = (): Draft => ({
  description: "",
  keys: new Set(CUSTOM_ROLE_DEFAULT_PERMISSION_KEYS),
  name: "",
});

const roleLook = (role: { id: string; name: string }) => {
  const builtIn = BUILT_IN_ROLES[role.name];
  return {
    hue: builtIn?.hue ?? hueFromId(role.id),
    Icon: builtIn ? ROLE_ICONS[builtIn.icon] : UserCog,
  };
};

const RoleCard = ({
  active,
  meta,
  name,
  onPick,
  roleId,
}: {
  active: boolean;
  meta: string;
  name: string;
  onPick: () => void;
  roleId: string;
}) => {
  const { Icon, hue } = roleLook({ id: roleId, name });
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-accent-soft",
        active
          ? "border-accent bg-card shadow-[0_0_0_3px_var(--accent-soft)]"
          : "border-border bg-transparent hover:bg-hover"
      )}
      onClick={onPick}
      type="button"
    >
      <span
        className="grid size-[26px] shrink-0 place-items-center rounded-[7px]"
        style={{
          background: `oklch(0.95 0.035 ${hue})`,
          color: `oklch(0.48 0.12 ${hue})`,
        }}
      >
        <Icon className="size-[13px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-[13.5px] leading-[1.25]">
          {name}
        </span>
        <span className="block truncate text-muted-foreground text-xs leading-[1.3]">
          {meta}
        </span>
      </span>
    </button>
  );
};

const PermissionGrid = ({
  editable,
  granted,
  onToggle,
}: {
  editable: boolean;
  granted: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) => (
  <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
    {PERMISSION_GROUPS.map((group) => {
      const Icon = GROUP_ICONS[group.icon];
      const on = group.items.filter((item) => granted.has(item.key)).length;
      return (
        <fieldset
          className="flex flex-col gap-[9px] border-border border-r border-b px-4 py-3.5"
          key={group.group}
        >
          <legend className="contents">
            <span className="flex items-center gap-[7px]">
              <Icon className="size-3.5 text-muted-foreground" />
              <span className="flex-1 font-semibold text-[13px] leading-none">
                {group.group}
              </span>
              <span className="font-medium font-mono text-[11px] text-muted-foreground leading-none">
                {on}/{group.items.length}
              </span>
            </span>
          </legend>
          {group.items.map((item) => (
            <Label
              className={cn(
                "gap-[9px] font-normal text-[13px] leading-[1.3]",
                editable ? "cursor-pointer" : "cursor-default"
              )}
              key={item.key}
            >
              <Checkbox
                checked={granted.has(item.key)}
                className={cn(
                  "disabled:cursor-default disabled:opacity-100",
                  editable
                    ? "data-checked:border-accent data-checked:bg-accent"
                    : "data-checked:border-foreground-2 data-checked:bg-foreground-2"
                )}
                disabled={!editable}
                onCheckedChange={() => onToggle(item.key)}
              />
              <span className="flex-1">{item.label}</span>
              <span className="font-mono text-[11px] text-faint leading-none">
                {item.key}
              </span>
            </Label>
          ))}
        </fieldset>
      );
    })}
  </div>
);

const RoleDetail = ({ role }: { role: Role }) => {
  const builtIn = BUILT_IN_ROLES[role.name];
  const granted = new Set(
    role.permissions.map(({ action, module }) => `${module}:${action}`)
  );
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-3.5">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[15px] leading-[1.3]">
              {role.name}
            </h3>
            <span className="rounded-[4px] border border-border bg-sunken px-1.5 py-1 font-medium text-[11px] text-muted-foreground leading-none">
              {builtIn ? "Built-in" : "Custom"}
            </span>
          </div>
          <p className="text-[12.5px] text-muted-foreground leading-[1.4]">
            {builtIn?.description ??
              role.description ??
              "A custom role for this organization."}
          </p>
        </div>
        <span className="font-medium font-mono text-[12.5px] text-muted-foreground">
          {plural(role._count.memberships, "member")}
        </span>
      </div>
      {builtIn ? null : (
        <p className="border-border border-b bg-sunken px-4 py-2 text-[12.5px] text-muted-foreground">
          A saved custom role can't be edited yet. Create a new role to change
          its permissions.
        </p>
      )}
      <PermissionGrid
        editable={false}
        granted={granted}
        onToggle={() => null}
      />
    </div>
  );
};

const DraftDetail = ({
  draft,
  onCancel,
  onChange,
  onSaved,
  organizationId,
}: {
  draft: Draft;
  onCancel: () => void;
  onChange: (draft: Draft) => void;
  onSaved: (role: Role) => void;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      apiClient.organizations.roles.create({
        ...(draft.description.trim()
          ? { description: draft.description.trim() }
          : {}),
        name: draft.name.trim(),
        organizationId,
        permissions: permissionsFromKeys(draft.keys),
      }),
    onError: (cause) =>
      toast.error("Could not save the role", {
        description: getApiErrorMessage(cause, "Try again."),
      }),
    onSuccess: ({ data }) => {
      toast.success("Role saved", {
        description: `${data.name} · ${plural(data.permissions.length, "permission")}`,
      });
      queryClient.invalidateQueries({
        queryKey: peopleKeys.roles(organizationId),
      });
      onSaved(data);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate();
  };
  const toggle = (key: string) => {
    const keys = new Set(draft.keys);
    if (keys.has(key)) {
      keys.delete(key);
    } else {
      keys.add(key);
    }
    onChange({ ...draft, keys });
  };
  return (
    <form
      className="overflow-hidden rounded-card border border-border bg-card"
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-end gap-3 border-border border-b px-4 py-3.5">
        <Field className="w-auto min-w-[180px] flex-1 gap-1.5">
          <FieldLabel htmlFor="role-name">Role name</FieldLabel>
          <Input
            autoFocus
            id="role-name"
            maxLength={40}
            minLength={2}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            placeholder="Support"
            required
            value={draft.name}
          />
        </Field>
        <Field className="w-auto min-w-[220px] flex-[2] gap-1.5">
          <FieldLabel htmlFor="role-description">Description</FieldLabel>
          <Input
            id="role-description"
            maxLength={160}
            onChange={(event) =>
              onChange({ ...draft, description: event.target.value })
            }
            placeholder="What this role is for"
            value={draft.description}
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={save.isPending || draft.keys.size === 0}
            size="sm"
            type="submit"
          >
            {save.isPending ? "Saving…" : "Save role"}
          </Button>
        </div>
      </div>
      <PermissionGrid editable granted={draft.keys} onToggle={toggle} />
    </form>
  );
};

const RolesSkeleton = () => (
  <div
    aria-busy="true"
    aria-label="Loading roles"
    className="flex flex-col gap-1.5"
    role="status"
  >
    {["owner", "admin", "member", "viewer"].map((key) => (
      <div
        className="flex h-[50px] flex-col justify-center gap-[7px] rounded-lg border border-border px-3"
        key={key}
      >
        <Shimmer className="w-1/2" />
        <Placeholder className="h-[9px] w-[70%]" />
      </div>
    ))}
  </div>
);

/** Roles on the left, the chosen role's permission grid on the right. */
export function RolesSection({
  canManage,
  organizationId,
}: {
  canManage: boolean;
  organizationId: string;
}) {
  const roles = useRoles(organizationId, true);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const list = sortRoles(roles.data ?? []);
  const current =
    selected === DRAFT
      ? null
      : (list.find((role) => role.id === selected) ?? list[0] ?? null);

  if (roles.isError) {
    return (
      <ErrorAlert
        message="Roles and assignments are unchanged."
        onRetry={() => roles.refetch()}
        title="Couldn't load roles."
      />
    );
  }

  return (
    <section className="grid items-start gap-[18px] lg:grid-cols-[250px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <SectionLabel className="px-1 pb-1.5">Roles</SectionLabel>
        {roles.isPending ? <RolesSkeleton /> : null}
        {list.map((role) => (
          <RoleCard
            active={selected !== DRAFT && current?.id === role.id}
            key={role.id}
            meta={`${plural(role._count.memberships, "member")} · ${plural(role.permissions.length, "permission")}`}
            name={role.name}
            onPick={() => setSelected(role.id)}
            roleId={role.id}
          />
        ))}
        {draft ? (
          <RoleCard
            active={selected === DRAFT}
            meta={`New · ${plural(draft.keys.size, "permission")}`}
            name={draft.name.trim() || "Untitled role"}
            onPick={() => setSelected(DRAFT)}
            roleId={DRAFT}
          />
        ) : null}
        {canManage && !draft ? (
          <Button
            className="mt-1 h-9 rounded-lg border-dashed bg-transparent text-foreground-2"
            onClick={() => {
              setDraft(newDraft());
              setSelected(DRAFT);
            }}
            variant="outline"
          >
            <Plus />
            Create custom role
          </Button>
        ) : null}
      </div>
      {selected === DRAFT && draft ? (
        <DraftDetail
          draft={draft}
          onCancel={() => {
            setDraft(null);
            setSelected(null);
          }}
          onChange={setDraft}
          onSaved={(role) => {
            setDraft(null);
            setSelected(role.id);
          }}
          organizationId={organizationId}
        />
      ) : null}
      {selected !== DRAFT && current ? <RoleDetail role={current} /> : null}
    </section>
  );
}
