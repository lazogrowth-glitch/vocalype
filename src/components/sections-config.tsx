import React from "react";
import {
  AlignLeft,
  BarChart2,
  Clock3,
  CreditCard,
  FlaskConical,
  Gift,
  History,
  Info,
  LayoutGrid,
  Mic,
  NotebookPen,
  Settings2,
  Zap,
} from "lucide-react";
import { GeneralSettings } from "./settings/general/GeneralSettings";

const AdvancedSettings = React.lazy(() =>
  import("./settings/advanced/AdvancedSettings").then((m) => ({
    default: m.AdvancedSettings,
  })),
);
const ReferralSettings = React.lazy(() =>
  import("./settings/referral/ReferralSettings").then((m) => ({
    default: m.ReferralSettings,
  })),
);
const HistorySettings = React.lazy(() =>
  import("./settings/history/HistorySettings").then((m) => ({
    default: m.HistorySettings,
  })),
);
const DebugSettings = React.lazy(() =>
  import("./settings/debug/DebugSettings").then((m) => ({
    default: m.DebugSettings,
  })),
);
const PostProcessingSettings = React.lazy(() =>
  import("./settings/post-processing/PostProcessingSettings").then((m) => ({
    default: m.PostProcessingSettings,
  })),
);
const ModelsSettings = React.lazy(() =>
  import("./settings/models/ModelsSettings").then((m) => ({
    default: m.ModelsSettings,
  })),
);
const BillingSettings = React.lazy(() =>
  import("./settings/billing/BillingSettings").then((m) => ({
    default: m.BillingSettings,
  })),
);

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: unknown) => boolean;
}

export type SidebarSection =
  | "general"
  | "models"
  | "postprocessing"
  | "snippets"
  | "history"
  | "meetings"
  | "notes"
  | "stats"
  | "advanced"
  | "debug"
  | "referral"
  | "billing"
  | "about";

const LAUNCH_HIDDEN_SECTIONS = new Set<SidebarSection>([
  "meetings",
  "notes",
  "snippets",
  "stats",
  "debug",
  "referral",
  "about",
]);

const isLaunchVisible = (section: SidebarSection) =>
  !LAUNCH_HIDDEN_SECTIONS.has(section);

export const isSectionVisibleInLaunch = (
  section: SidebarSection,
  settings: unknown,
) => SECTIONS_CONFIG[section]?.enabled(settings) === true;

export const SECTIONS_CONFIG = {
  // ── Configuration ─────────────────────────────────────
  general: {
    labelKey: "sidebar.general",
    icon: LayoutGrid,
    component: GeneralSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Clock3,
    component: ModelsSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: AlignLeft,
    component: PostProcessingSettings,
    enabled: () => true,
  },
  snippets: {
    labelKey: "sidebar.snippets",
    icon: Zap,
    component: GeneralSettings,
    enabled: () => isLaunchVisible("snippets"),
  },
  // ── Utilisation ───────────────────────────────────────
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  meetings: {
    labelKey: "sidebar.meetings",
    icon: Mic,
    component: GeneralSettings,
    enabled: () => isLaunchVisible("meetings"),
  },
  notes: {
    labelKey: "sidebar.notes",
    icon: NotebookPen,
    component: GeneralSettings,
    enabled: () => isLaunchVisible("notes"),
  },
  stats: {
    labelKey: "sidebar.stats",
    icon: BarChart2,
    component: GeneralSettings,
    enabled: () => isLaunchVisible("stats"),
  },
  // ── Avancé ────────────────────────────────────────────
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Settings2,
    component: AdvancedSettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) =>
      import.meta.env.DEV &&
      typeof settings === "object" &&
      settings !== null &&
      "debug_mode" in settings &&
      settings.debug_mode === true,
  },
  // ── Bas de sidebar ────────────────────────────────────
  referral: {
    labelKey: "sidebar.referral",
    icon: Gift,
    component: ReferralSettings,
    enabled: () => isLaunchVisible("referral"),
  },
  billing: {
    labelKey: "sidebar.billing",
    icon: CreditCard,
    component: BillingSettings,
    enabled: () => true,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: GeneralSettings,
    enabled: () => isLaunchVisible("about"),
  },
} as const satisfies Record<SidebarSection, SectionConfig>;
