import { DesignSystemProvider } from "@repo/design-system";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ActiveOrganizationProvider } from "./lib/active-organization";
import "./styles.css";

export const metadata: Metadata = {
  description: "Authenticated product app surface.",
  robots: {
    follow: false,
    index: false,
  },
  title: "Shopify Toolkit App",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <DesignSystemProvider>
          <ActiveOrganizationProvider>{children}</ActiveOrganizationProvider>
        </DesignSystemProvider>
      </body>
    </html>
  );
}
