import { redirect } from "next/navigation";

/** Shopify is a sidebar group, not a page: its first tool opens instead. */
export default function ShopifyPage() {
  redirect("/shopify/metafields");
}
