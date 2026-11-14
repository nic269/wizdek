import { redirect } from "next/navigation";

export default async function LegacyOmsPage({
  params,
}: {
  params: Promise<{ legacy?: string[] }>;
}) {
  const { legacy = [] } = await params;
  const profile = legacy[0] === "e" ? legacy[1] : undefined;
  redirect(
    `/works/oms-management${profile ? `?${new URLSearchParams({ profile })}` : ""}`
  );
}
