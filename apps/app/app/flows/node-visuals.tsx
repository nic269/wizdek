import {
  Box,
  Boxes,
  Braces,
  CalendarClock,
  cn,
  FileSpreadsheet,
  Filter,
  GitFork,
  PackageSearch,
  PencilLine,
  Play,
  Split,
  Tag,
  Webhook,
} from "@repo/design-system";
import type { CSSProperties, ReactNode } from "react";

export type NodeCategory = "trigger" | "data" | "logic" | "action";

/** The hue of each step category, used for its chip, label and handles. */
export const CATEGORY_HUES: Record<NodeCategory, number> = {
  action: 160,
  data: 230,
  logic: 75,
  trigger: 300,
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  action: "Action",
  data: "Data",
  logic: "Logic",
  trigger: "Trigger",
};

/** Palette group titles, in palette order. */
export const CATEGORY_GROUPS: { id: NodeCategory; label: string }[] = [
  { id: "trigger", label: "Triggers" },
  { id: "data", label: "Data" },
  { id: "logic", label: "Logic" },
  { id: "action", label: "Shopify actions" },
];

const NODE_ICONS: Record<string, ReactNode> = {
  "data.parseCsv": <FileSpreadsheet />,
  "data.setFields": <PencilLine />,
  "logic.filter": <Filter />,
  "logic.if": <Split />,
  "logic.switch": <GitFork />,
  "shopify.addTags": <Tag />,
  "shopify.bulkMutation": <Boxes />,
  "shopify.findOrder": <PackageSearch />,
  "shopify.graphql": <Braces />,
  "trigger.manual": <Play />,
  "trigger.schedule": <CalendarClock />,
  "trigger.webhook": <Webhook />,
};

export const nodeIcon = (nodeType: string) => NODE_ICONS[nodeType] ?? <Box />;

export const asCategory = (category: string | undefined): NodeCategory =>
  category && category in CATEGORY_HUES ? (category as NodeCategory) : "action";

/** The design-token name of each category's colour pair. */
const CATEGORY_TOKENS: Record<NodeCategory, string> = {
  action: "shopify",
  data: "data",
  logic: "logic",
  trigger: "trigger",
};

/** CSS variables for a category: `--cat` (ink) and `--cat-tint` (chip). */
export const categoryStyle = (category: NodeCategory): CSSProperties =>
  ({
    "--cat": `var(--cat-${CATEGORY_TOKENS[category]})`,
    "--cat-tint": `var(--cat-${CATEGORY_TOKENS[category]}-tint)`,
  }) as CSSProperties;

const chipRadius = (size: number) => {
  if (size >= 30) {
    return 8;
  }
  return size >= 26 ? 7 : 6;
};

/** A step's icon on its category tint. */
export const CategoryChip = ({
  category,
  className,
  nodeType,
  size = 30,
}: {
  category: NodeCategory;
  className?: string | undefined;
  nodeType: string;
  size?: number;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "grid shrink-0 place-items-center bg-(--cat-tint) text-(--cat)",
      className
    )}
    style={{
      ...categoryStyle(category),
      borderRadius: chipRadius(size),
      height: size,
      width: size,
    }}
  >
    <span
      className="grid place-items-center"
      style={{ height: size / 2, width: size / 2 }}
    >
      <span className="contents [&_svg]:size-full">{nodeIcon(nodeType)}</span>
    </span>
  </span>
);

const TRIGGER_NAMES: Record<string, string> = {
  "trigger.manual": "Manual",
  "trigger.schedule": "Schedule",
  "trigger.webhook": "Webhook",
};

export const triggerName = (triggerType: string | null) =>
  triggerType ? (TRIGGER_NAMES[triggerType] ?? triggerType) : "No trigger";
