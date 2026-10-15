import { appConfig } from "@repo/config";
import {
  BrandMark,
  cn,
  EnvTag,
  FileSpreadsheet,
  type LucideIcon,
  PackageSearch,
  SectionLabel,
  Split,
  Tag,
} from "@repo/design-system";
import type { ReactNode } from "react";

type ChipTone = "success" | "danger" | "info" | "unknown";

const CHIP_CLASSES: Record<ChipTone, string> = {
  danger: "bg-(--status-danger-bg) text-(--status-danger-fg)",
  info: "bg-(--status-info-bg) text-(--status-info-fg)",
  success: "bg-(--status-success-bg) text-(--status-success-fg)",
  unknown: "bg-(--status-unknown-bg) text-(--status-unknown-fg)",
};

const PREVIEW_STEPS: {
  chips: { label: string; tone: ChipTone }[];
  hue: number;
  icon: LucideIcon;
  name: string;
}[] = [
  {
    chips: [{ label: "240 ✓", tone: "success" }],
    hue: 230,
    icon: FileSpreadsheet,
    name: "Parse CSV",
  },
  {
    chips: [
      { label: "236 ✓", tone: "success" },
      { label: "4 ✗", tone: "danger" },
    ],
    hue: 160,
    icon: PackageSearch,
    name: "Find order",
  },
  {
    chips: [{ label: "61 true", tone: "info" }],
    hue: 75,
    icon: Split,
    name: "If total > 1000",
  },
  {
    chips: [
      { label: "53 ✓", tone: "success" },
      { label: "5 ✗", tone: "danger" },
      { label: "3 ?", tone: "unknown" },
    ],
    hue: 160,
    icon: Tag,
    name: "Add tags",
  },
];

/** A static run trace, as an illustration of what the product does. */
const RunTracePreview = () => (
  <div
    aria-hidden="true"
    className="max-w-[460px] overflow-hidden rounded-xl border border-sidebar-border bg-white text-[#1d1d1b] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.35)]"
  >
    <div className="flex items-center gap-2 border-[#ecebe7] border-b px-3.5 py-3">
      <span className="flex-1 font-semibold text-[13px] leading-none">
        Run #128 · Tag high-value orders
      </span>
      <EnvTag environment="PROD" />
    </div>
    {PREVIEW_STEPS.map((step) => {
      const Icon = step.icon;
      return (
        <div
          className="flex items-center gap-2.5 border-[#f1f0ec] border-b px-3.5 py-2.5 last:border-b-0"
          key={step.name}
        >
          <span
            className="grid size-6 place-items-center rounded-md"
            style={{
              background: `oklch(0.95 0.035 ${step.hue})`,
              color: `oklch(0.5 0.14 ${step.hue})`,
            }}
          >
            <Icon className="size-3" />
          </span>
          <span className="flex-1 font-medium text-[12.5px] leading-[1.2]">
            {step.name}
          </span>
          {step.chips.map((chip) => (
            <span
              className={cn(
                "rounded-full px-1.5 py-1 font-semibold text-[10.5px] leading-none",
                CHIP_CLASSES[chip.tone]
              )}
              key={chip.label}
            >
              {chip.label}
            </span>
          ))}
        </div>
      );
    })}
  </div>
);

/**
 * The auth pages: a form column with the brand and a footer, beside a
 * sidebar-coloured panel that says what the product is for.
 */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-card text-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-screen flex-col px-4 py-[22px] sm:px-7">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-semibold text-[14.5px] leading-none tracking-[-0.01em]">
            {appConfig.name}
          </span>
        </div>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-[380px] flex-col gap-[22px]">
            {children}
          </div>
        </main>
        <footer className="text-faint text-xs leading-[1.4]">
          © {new Date().getFullYear()} Wizloft · Internal developer tool
        </footer>
      </div>
      <aside className="hidden flex-col justify-center gap-[30px] overflow-hidden border-sidebar-border border-l bg-sidebar p-12 text-sidebar-foreground md:flex">
        <div className="max-w-[460px]">
          <SectionLabel className="mb-3.5 text-sidebar-muted">
            For teams running many Shopify stores
          </SectionLabel>
          <p className="text-pretty font-semibold text-[30px] leading-[1.15] tracking-[-0.025em]">
            Query any store, automate per-item work, and see exactly what
            happened.
          </p>
        </div>
        <RunTracePreview />
      </aside>
    </div>
  );
}

/** The title and one sentence at the top of each auth form. */
export const AuthHeading = ({
  children,
  title,
}: {
  children?: ReactNode;
  title: string;
}) => (
  <div>
    <h1 className="m-0 font-semibold text-[26px] leading-[1.15] tracking-[-0.02em]">
      {title}
    </h1>
    {children ? (
      <p className="mt-2 text-muted-foreground text-sm leading-normal [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </p>
    ) : null}
  </div>
);

const ICON_TONES = {
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-(--status-success-bg) text-(--status-success-fg)",
  warning: "bg-(--status-warning-bg) text-(--status-warning-fg)",
} as const;

/** A 44px icon tile above a confirmation heading. */
export const AuthIcon = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: keyof typeof ICON_TONES;
}) => (
  <div
    className={cn(
      "grid size-11 place-items-center rounded-xl [&_svg]:size-5",
      ICON_TONES[tone]
    )}
  >
    {children}
  </div>
);
