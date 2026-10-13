import { createAuthGuard } from "@repo/auth/middleware";

export default createAuthGuard({
  dashboard: "/dashboard",
  protectedPrefixes: ["/settings", "/stores", "/graphql", "/flows"],
  signIn: "/sign-in",
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/stores/:path*",
    "/graphql/:path*",
    "/flows/:path*",
  ],
};
