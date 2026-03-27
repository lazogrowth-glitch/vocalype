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
const AboutSettings = React.lazy(() =>
  import("./settings/about/AboutSettings").then((m) => ({
    default: m.AboutSettings,
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
const SnippetsSettings = React.lazy(() =>
  import("./settings/snippets/SnippetsSettings").then((m) => ({
    default: m.SnippetsSettings,
  })),
);
const NotesSettings = React.lazy(() =>
  import("./settings/notes/NotesSettings").then((m) => ({
    default: m.NotesSettings,
  })),
);
const MeetingsSettings = React.lazy(() =>
  import("./settings/meetings/MeetingsSettings").then((m) => ({
    default: m.MeetingsSettings,
  })),
);
const BillingSettings = React.lazy(() =>
  import("./settings/billing/BillingSettings").then((m) => ({
    default: m.BillingSettings,
  })),
);
const ReferralSettings = React.lazy(() =>
  import("./settings/referral/ReferralSettings").then((m) => ({
    default: m.ReferralSettings,
  })),
);
const StatsSettings = React.lazy(() =>
  import("./settings/stats/StatsSettings").then((m) => ({
    default: m.StatsSettings,
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
  enabled: (settings: any) => boolean;
}

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
    component: SnippetsSettings,
    enabled: () => true,
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
    component: MeetingsSettings,
    enabled: () => true,
  },
  notes: {
    labelKey: "sidebar.notes",
    icon: NotebookPen,
    component: NotesSettings,
    enabled: () => true,
  },
  stats: {
    labelKey: "sidebar.stats",
    icon: BarChart2,
    component: StatsSettings,
    enabled: () => true,
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
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  // ── Bas de sidebar ────────────────────────────────────
  referral: {
    labelKey: "sidebar.referral",
    icon: Gift,
    component: ReferralSettings,
    enabled: () => true,
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
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

export type SidebarSection = keyof typeof SECTIONS_CONFIG;
