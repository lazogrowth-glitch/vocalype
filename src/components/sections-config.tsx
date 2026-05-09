import React from "react";
import {
  AlignLeft,
  BarChart2,
  CreditCard,
  FlaskConical,
  History,
  Info,
  LayoutGrid,
  Mic,
  Settings2,
  Zap,
  AudioWaveform,
} from "lucide-react";

const GeneralSettings = React.lazy(() =>
  import("./settings/general/GeneralSettings").then((m) => ({
    default: m.GeneralSettings,
  })),
);

const DictationSettings = React.lazy(() =>
  import("./settings/dictation/DictationSettings").then((m) => ({
    default: m.DictationSettings,
  })),
);

const MeetingsSettings = React.lazy(() =>
  import("./settings/meetings/MeetingsSettings").then((m) => ({
    default: m.MeetingsSettings,
  })),
);

const PreferencesSettings = React.lazy(() =>
  import("./settings/preferences/PreferencesSettings").then((m) => ({
    default: m.PreferencesSettings,
  })),
);
const HistorySettings = React.lazy(() =>
  import("./settings/history/HistorySettings").then((m) => ({
    default: m.HistorySettings,
  })),
);
const DiagnosticsSettings = React.lazy(() =>
  import("./settings/diagnostics/DiagnosticsSettings").then((m) => ({
    default: m.DiagnosticsSettings,
  })),
);
const PostProcessingSettings = React.lazy(() =>
  import("./settings/postprocessing/PostProcessingSettings").then((m) => ({
    default: m.PostProcessingSettings,
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
  [key: string]: unknown;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: unknown) => boolean;
  fullBleed?: boolean;
}

export type SidebarSection =
  | "general"
  | "postprocessing"
  | "snippets"
  | "history"
  | "meetings"
  | "dictee"
  | "stats"
  | "advanced"
  | "debug"
  | "billing"
  | "about";

const LAUNCH_HIDDEN_SECTIONS = new Set<SidebarSection>([
  "snippets",
  "stats",
  "debug",
  "about",
]);

const isLaunchVisible = (section: SidebarSection) =>
  !LAUNCH_HIDDEN_SECTIONS.has(section);

export const isSectionVisibleInLaunch = (
  section: SidebarSection,
  settings: unknown,
) => SECTIONS_CONFIG[section]?.enabled(settings) === true;

export const SECTIONS_CONFIG: Record<SidebarSection, SectionConfig> = {
  // ── Configuration ─────────────────────────────────────
  dictee: {
    labelKey: "sidebar.dictee",
    icon: AudioWaveform,
    component: DictationSettings,
    enabled: () => true,
    fullBleed: true,
  },
  general: {
    labelKey: "sidebar.general",
    icon: LayoutGrid,
    component: GeneralSettings,
    enabled: () => false,
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
    fullBleed: true,
  },
  meetings: {
    labelKey: "sidebar.meetings",
    icon: Mic,
    component: MeetingsSettings,
    enabled: () => true,
    fullBleed: true,
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
    component: PreferencesSettings,
    enabled: () => true,
    fullBleed: true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DiagnosticsSettings,
    enabled: () => true,
    fullBleed: true,
  },
  // ── Bas de sidebar ────────────────────────────────────
  billing: {
    labelKey: "sidebar.billing",
    icon: CreditCard,
    component: BillingSettings,
    enabled: () => true,
    fullBleed: true,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: GeneralSettings,
    enabled: () => isLaunchVisible("about"),
  },
};
