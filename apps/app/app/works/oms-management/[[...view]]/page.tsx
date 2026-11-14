import { PageHeader } from "@repo/design-system";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShellLayout } from "../../../app-shell-layout";
import { ManagementApp } from "../_module/components/management-app";
import { managementHref, sectionForPath } from "../_module/lib/navigation";
import { getConfig } from "../_module/server/config";
import { ManagementError } from "../_module/server/errors";
import { requireIdentity } from "../_module/server/identity/wizdek-session";

const PROFILE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
export const metadata = { title: "OMS management" };
export const runtime = "nodejs";
export default async function OmsManagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ view?: string[] }>;
  searchParams: Promise<{ profile?: string }>;
}) {
  const [{ view = [] }, search] = await Promise.all([params, searchParams]);
  const section = sectionForPath(view);
  if (!section) {
    notFound();
  }
  const profileId =
    typeof search.profile === "string" && PROFILE_ID.test(search.profile)
      ? search.profile
      : undefined;
  let accessError: string | undefined;
  try {
    await requireIdentity(
      new Request("http://management.internal", { headers: await headers() }),
      getConfig()
    );
  } catch (error) {
    if (!(error instanceof ManagementError)) {
      throw error;
    }
    if (error.status === 401) {
      redirect(
        `/sign-in?callbackUrl=${encodeURIComponent(managementHref(section, profileId))}`
      );
    }
    accessError = error.message;
  }
  return (
    <AppShellLayout
      requiresOrganization={false}
      signInCallback={managementHref(section, profileId)}
      width="full"
    >
      {accessError ? (
        <div className="p-8">
          <PageHeader description={accessError} title="OMS management access" />
        </div>
      ) : (
        <ManagementApp profileId={profileId} section={section} />
      )}
    </AppShellLayout>
  );
}
