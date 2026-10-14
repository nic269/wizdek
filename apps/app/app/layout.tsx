import { appConfig } from "@repo/config";
import { DesignSystemProvider } from "@repo/design-system";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ActiveOrganizationProvider } from "./lib/active-organization";
import { Providers } from "./providers";
import "./styles.css";

export const metadata: Metadata = {
  description: appConfig.description,
  robots: {
    follow: false,
    index: false,
  },
  title: { default: appConfig.name, template: `%s · ${appConfig.shortName}` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Extensions such as Grammarly add body attributes before hydration. */}
      <body className="product-app" suppressHydrationWarning>
        <DesignSystemProvider
          defaultTheme="light"
          enableSystem={false}
          storageKey="shopify-toolkit-theme"
        >
          <Providers>
            <ActiveOrganizationProvider>{children}</ActiveOrganizationProvider>
          </Providers>
        </DesignSystemProvider>
      </body>
    </html>
  );
}
