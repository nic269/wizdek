import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg border bg-clip-padding font-medium text-[13px] outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg:not([class*='size-'])]:size-[15px] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    // Filled buttons are a pixel wider each side than outlined ones.
    compoundVariants: [
      { class: "px-[13px]", size: "default", variant: ["default", "danger"] },
    ],
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        // Page headers and forms.
        default: "h-8 gap-1.5 px-3",
        icon: "size-8",
        "icon-lg": "size-9",
        "icon-sm": "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[38px] gap-[7px] px-4",
        // Toolbars and table rows.
        sm: "h-7 gap-1.5 px-2.5 text-[12.5px] [&_svg:not([class*='size-'])]:size-3.5",
        // Compact controls.
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        danger:
          "border-(--danger-solid) bg-(--danger-solid) text-white hover:bg-(--danger-solid)/90 focus-visible:ring-(--status-danger-bg)",
        default:
          "border-primary bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(22,23,26,0.2),inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[#2a2c31] hover:bg-[#2a2c31]",
        destructive:
          "border-(--danger-outline) bg-card text-(--status-danger-fg) hover:bg-(--alert-danger-bg) focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        ghost:
          "border-transparent text-foreground-2 hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
        link: "h-auto border-transparent px-0 text-accent-ink underline-offset-4 hover:underline",
        outline:
          "border-input bg-card text-foreground shadow-[0_1px_1px_rgba(22,23,26,0.04)] hover:bg-sunken aria-expanded:bg-hover",
        secondary:
          "border-input bg-card text-foreground hover:bg-hover aria-expanded:bg-hover",
      },
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      {...props}
    />
  );
}

export { Button, buttonVariants };
