export const dynamic = "force-dynamic";
export const GET = () =>
  Response.json(
    { service: "oms-management", status: "alive" },
    { headers: { "Cache-Control": "no-store" } }
  );
