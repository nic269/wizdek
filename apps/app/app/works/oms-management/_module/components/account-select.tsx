"use client";
import { useQuery } from "@tanstack/react-query";
import type { PublicProfile } from "../lib/contracts";
import { request } from "./management-app";
import { ChoiceSelect, ErrorNotice } from "./oms-ui";

export function AccountSelect({
  profile,
  id,
  value,
  onValueChange,
}: {
  profile: PublicProfile;
  id: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const accounts = useQuery({
    queryFn: ({ signal }) =>
      request<{
        data: {
          rows: {
            id: string;
            name: string;
            users: { name: string; email: string }[];
          }[];
        };
      }>(
        "diagnostics?" +
          new URLSearchParams({
            profileId: profile.id,
            resource: "accounts",
            revision: String(profile.revision),
          }),
        { signal }
      ),
    queryKey: ["oms", profile.id, profile.revision, "accounts"],
  });
  return (
    <div className="flex flex-col gap-2">
      <ChoiceSelect
        choices={(accounts.data?.data.rows ?? []).map((account) => ({
          label: `${account.name} · ${account.users.map((user) => user.email || user.name).join(", ") || account.id}`,
          value: account.id,
        }))}
        id={id}
        label="OMS account"
        onValueChange={onValueChange}
        placeholder={
          accounts.isPending ? "Loading accounts…" : "Select an account"
        }
        value={value}
      />
      {accounts.error ? <ErrorNotice message={accounts.error.message} /> : null}
    </div>
  );
}
