import React from "react";
import {
  AlignLeft,
  Building2,
  CreditCard,
  FlaskConical,
  History,
  Mic,
  Settings2,
  AudioWaveform,
} from "lucide-react";
import { DictationSettings } from "./settings/dictation/DictationSettings";
import { MeetingsSettings } from "./settings/meetings/MeetingsSettings";
import { PreferencesSettings } from "./settings/preferences/PreferencesSettings";
import { HistorySettings } from "./settings/history/HistorySettings";
import { DiagnosticsSettings } from "./settings/diagnostics/DiagnosticsSettings";
import { PostProcessingSettings } from "./settings/postprocessing/PostProcessingSettings";
import { BillingSettings } from "./settings/billing/BillingSettings";
import { WorkspaceSettings } from "./settings/workspace/WorkspaceSettings";

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
  | "postprocessing"
  | "history"
  | "meetings"
  | "workspace"
  | "dictee"
  | "settings"
  | "debug"
  | "billing";

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
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: AlignLeft,
    component: PostProcessingSettings,
    enabled: () => true,
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
  // ── Avancé ────────────────────────────────────────────
  workspace: {
    labelKey: "sidebar.workspace",
    icon: Building2,
    component: WorkspaceSettings,
    enabled: () => true,
    fullBleed: true,
  },
  settings: {
    labelKey: "sidebar.settings",
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
};
