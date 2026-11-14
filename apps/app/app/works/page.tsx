import { redirect } from "next/navigation";

/** Works is a sidebar group, not a page: its only tool opens instead. */
export default function WorksPage() {
  redirect("/works/oms-management");
}
