import { notFound } from "next/navigation";
import { ManagementApp } from "../../../../../../../components/management-app";
import { sectionForPath } from "../../../../../../../lib/navigation";

export default async function OmsHarnessPage({
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
  return <ManagementApp profileId={search.profile} section={section} />;
}
