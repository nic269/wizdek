import { DesignSystemProvider } from "@repo/design-system";
import type { Metadata } from "next";
import type { ReactNode } from "react";
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
        <DesignSystemProvider>{children}</DesignSystemProvider>
      </body>
    </html>
  );
}
