export const plans = [
  {
    features: ["basic"],
    id: "free",
    limits: { projects: 1, storageMb: 100 },
    name: "Free",
  },
  {
    features: ["basic", "advanced"],
    id: "pro",
    limits: { projects: 10, storageMb: 10_000 },
    name: "Pro",
  },
] as const;
