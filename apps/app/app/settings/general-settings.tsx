"use client";

import { authClient } from "@repo/auth/client";
import {
  BadgeCheck,
  Button,
  Input,
  initialsOf,
  ListChecks,
  Lock,
  toast,
} from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { onboardingHiddenKey, readFlag, writeFlag } from "../lib/onboarding";
import { usePermissions } from "../lib/permissions";

/** A settings section: a 240px label column beside its fields. */
const SettingsSection = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) => (
  <section className="grid gap-x-6 gap-y-3 border-border border-b pb-[22px] md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
    <div>
      <h2 className="font-semibold text-sm leading-[1.3]">{title}</h2>
      <p className="text-[13px] text-muted-foreground leading-normal">
        {description}
      </p>
    </div>
    <div className="flex flex-col gap-3.5">{children}</div>
  </section>
);

const FieldNote = ({
  children,
  icon,
}: {
  children: ReactNode;
  icon: ReactNode;
}) => (
  <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground leading-[1.4] [&_svg]:size-[13px]">
    {icon}
    {children}
  </p>
);

/**
 * The dashboard hides its setup checklist per browser; this brings it back,
 * as the toast shown on hiding promises.
 */
const ChecklistToggle = ({ organizationId }: { organizationId: string }) => {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(readFlag(onboardingHiddenKey(organizationId)));
  }, [organizationId]);
  if (!hidden) {
    return null;
  }
  return (
    <div className="flex max-w-[420px] flex-wrap items-center gap-3 rounded-menu border border-border bg-sunken px-3 py-2.5">
      <ListChecks className="size-4 text-muted-foreground" />
      <span className="flex-1 text-[13px] text-foreground-2">
        The setup checklist is hidden on the dashboard.
      </span>
      <Button
        onClick={() => {
          writeFlag(onboardingHiddenKey(organizationId), false);
          setHidden(false);
          toast.success("Setup checklist restored", {
            description: "It's back on the dashboard.",
          });
        }}
        size="sm"
        variant="outline"
      >
        Show it again
      </Button>
    </div>
  );
};

const OrganizationSection = () => {
  const { organization } = useActiveOrganization();
  const { can } = usePermissions();
  if (!organization) {
    return null;
  }
  return (
    <SettingsSection
      description="Everything in wizdek belongs to an organization."
      title="Organization"
    >
      <Field className="max-w-[420px] gap-1.5">
        <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
        <Input
          className="bg-sunken"
          id="organization-name"
          readOnly
          value={organization.name}
        />
        <FieldNote icon={<Lock />}>
          {can("organization:update")
            ? "Renaming the organization isn't available yet."
            : "Only Owners can rename the organization."}
        </FieldNote>
      </Field>
      <ChecklistToggle organizationId={organization.id} />
    </SettingsSection>
  );
};

export function GeneralSettings({
  user,
}: {
  user: { email: string; emailVerified: boolean; name: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [isSaving, setIsSaving] = useState(false);
  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== user.name;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changed) {
      return;
    }
    setIsSaving(true);
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result.error) {
        throw new Error(result.error.message);
      }
      toast.success("Settings saved");
      // The shell reads the name on the server.
      router.refresh();
    } catch {
      toast.error("Could not save your profile", { description: "Try again." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="flex max-w-[860px] flex-col gap-[18px]" onSubmit={save}>
      <SettingsSection
        description="Shown to teammates on runs, saved queries and the audit log."
        title="Your profile"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-full bg-[#e9e3dc] font-semibold text-[#5a4636] text-[15px] leading-none"
          >
            {initialsOf(trimmed || user.name)}
          </span>
          <p className="text-[12.5px] text-muted-foreground leading-[1.4]">
            Initials are generated from your name.
          </p>
        </div>
        <Field className="max-w-[420px] gap-1.5">
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input
            autoComplete="name"
            id="profile-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </Field>
        <Field className="max-w-[420px] gap-1.5">
          <FieldLabel htmlFor="profile-email">Email</FieldLabel>
          <div className="relative">
            <Input
              className="bg-sunken pr-24 text-muted-foreground"
              id="profile-email"
              readOnly
              value={user.email}
            />
            {user.emailVerified ? (
              <span className="absolute inset-y-0 right-2.5 inline-flex items-center gap-1 font-medium text-(--status-success-fg) text-[11.5px]">
                <BadgeCheck className="size-[13px]" />
                Verified
              </span>
            ) : null}
          </div>
        </Field>
      </SettingsSection>
      <OrganizationSection />
      <div className="flex gap-2">
        <Button disabled={!changed || isSaving} type="submit">
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
