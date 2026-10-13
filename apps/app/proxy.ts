import { createAuthGuard } from "@repo/auth/middleware";

export default createAuthGuard({ dashboard: "/dashboard", signIn: "/sign-in" });

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*"],
};
