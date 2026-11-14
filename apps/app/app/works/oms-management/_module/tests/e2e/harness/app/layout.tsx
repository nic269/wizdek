import type { ReactNode } from "react";
import "../../../../../../../styles.css";

export default function HarnessLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
