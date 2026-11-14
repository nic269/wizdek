import { appConfig } from "@repo/config";
import {
  BrandLogo,
  ContextChip,
  cn,
  EnvTag,
  IdentityChip,
  StatusBadge,
} from "@repo/design-system";
import type { ReactNode } from "react";

const RUN_SEGMENTS = [
  { color: "var(--status-success-dot)", size: 290 },
  { color: "var(--status-danger-dot)", size: 9 },
  { color: "var(--status-unknown-bg)", size: 3 },
  { color: "var(--border)", size: 16 },
] as const;

const PREVIEW_CARD =
  "flex flex-col rounded-card bg-card px-4 py-3.5 shadow-[0_0_0_1px_var(--border),0_24px_48px_-24px_rgba(22,23,26,0.2)]";

/** A static target and run, as an illustration of what the product does. */
const ProductPreview = () => (
  <div className="relative flex w-full max-w-[440px] flex-col gap-3.5">
    <div className={`${PREVIEW_CARD} gap-2.5`}>
      <div className="flex items-center">
        <span className="flex-1 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
          Target
        </span>
        <span className="font-mono text-[11px] text-faint">always visible</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <ContextChip>
          <IdentityChip id="atelier-uk" name="atelier-uk" size={18} />
          atelier-uk
        </ContextChip>
        <ContextChip risk="staging">
          <EnvTag environment="STAGING" />
          OMS
        </ContextChip>
        <ContextChip risk="production">
          <EnvTag environment="PROD" />
          OMS
        </ContextChip>
      </div>
    </div>
    <div className={`${PREVIEW_CARD} ml-12 gap-2`}>
      <div className="flex items-center">
        <span className="flex-1 font-medium text-[11px] text-faint uppercase tracking-[0.06em]">
          Run · Add tags
        </span>
        <StatusBadge tone="info">Running</StatusBadge>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-muted">
        {RUN_SEGMENTS.map((segment) => (
          <span
            key={segment.color}
            style={{ background: segment.color, flex: segment.size }}
          />
        ))}
      </div>
      <div className="flex gap-1.5">
        <StatusBadge tone="success">290</StatusBadge>
        <StatusBadge tone="danger">9</StatusBadge>
        <StatusBadge tone="unknown">3 unknown</StatusBadge>
      </div>
    </div>
    <p className="mt-6 text-pretty font-[550] text-[22px] text-foreground-2 leading-[30px] tracking-[-0.02em]">
      Every store, every run, every environment —{" "}
      <span className="text-foreground">
        and always the one you're about to change.
      </span>
    </p>
  </div>
);

/**
 * The auth pages: a form column with the brand and a footer, beside a
 * quiet panel that shows what the product keeps in view.
 */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-card text-foreground md:grid-cols-2">
      <div className="flex min-h-screen flex-col px-4 py-8 sm:px-10">
        <div className="flex items-center gap-2.5 self-start">
          <BrandLogo height={22} label={appConfig.name} />
          <span className="inline-flex h-5 items-center rounded-[5px] bg-hover px-1.5 font-medium text-[11px] text-foreground-2">
            devkit
          </span>
        </div>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-[360px] flex-col gap-5">
            {children}
          </div>
        </main>
        <footer className="flex items-center font-mono text-[11px] text-faint">
          <span>{appConfig.versionLabel}</span>
          <span className="flex-1" />
          <span>© {new Date().getFullYear()} Wizloft</span>
        </footer>
      </div>
      <aside
        aria-hidden="true"
        className="relative hidden items-center justify-center overflow-hidden bg-background p-12 md:flex"
      >
        <div className="absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-size-[48px_48px] opacity-60" />
        <ProductPreview />
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
    <h1 className="m-0 font-semibold text-[28px] leading-[1.15] tracking-[-0.02em]">
      {title}
    </h1>
    {children ? (
      <p className="mt-1.5 text-muted-foreground text-sm leading-normal [&_strong]:font-semibold [&_strong]:text-foreground">
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
