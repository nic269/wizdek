import { getCurrentSession } from "@repo/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@repo/design-system";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../app-shell-layout";
import { OrganizationsPanel } from "./organizations-panel";

export default async function DashboardPage() {
  const session = await getCurrentSession(await headers());

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description={`Signed in as ${session.user.email}.`}
          title="Dashboard"
        />
        <div className="grid gap-4 md:grid-cols-3">
          <OrganizationsPanel />
          <Card>
            <CardHeader>
              <CardTitle>API</CardTitle>
              <CardDescription>
                Hono health and OpenAPI surfaces are mounted separately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a className="font-medium text-blue-600 text-sm" href="/status">
                Check status
              </a>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Providers</CardTitle>
              <CardDescription>
                Mail, storage, jobs, billing, analytics, and docs are optional.
              </CardDescription>
            </CardHeader>
            <CardContent className="font-semibold text-2xl">
              Graceful
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShellLayout>
  );
}
