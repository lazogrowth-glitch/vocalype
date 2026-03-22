import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  BarChart2,
  Clock3,
  FlaskConical,
  History,
  Info,
  LayoutGrid,
  Settings2,
  Zap,
} from "lucide-react";
import VocalTypeLogo from "./icons/VocalTypeLogo";
import { MachineStatusBar } from "./MachineStatusBar";
import { TranscriptionWarmupBadge } from "./TranscriptionWarmupBadge";
import { useSettings } from "../hooks/useSettings";
import { usePlan } from "@/lib/subscription/context";
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
const StatsSettings = React.lazy(() =>
  import("./settings/stats/StatsSettings").then((m) => ({
    default: m.StatsSettings,
  })),
);

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

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
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Settings2,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: AlignLeft,
    component: PostProcessingSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  snippets: {
    labelKey: "sidebar.snippets",
    icon: Zap,
    component: SnippetsSettings,
    enabled: () => true,
  },
  stats: {
    labelKey: "sidebar.stats",
    icon: BarChart2,
    component: StatsSettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

function useTrialBadge(trialEndsAt: string | null) {
  if (!trialEndsAt) return null;
  const days = Math.max(
    0,
    Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000),
  );
  if (days >= 8) return { days, urgency: "neutral" as const };
  if (days >= 3) return { days, urgency: "warning" as const };
  return { days, urgency: "urgent" as const };
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { isTrialing, trialEndsAt, onStartCheckout } = usePlan();
  const trialBadge = useTrialBadge(isTrialing ? trialEndsAt : null);

  const availableSections = useMemo(
    () =>
      Object.entries(SECTIONS_CONFIG)
        .filter(([_, config]) => config.enabled(settings))
        .map(([id, config]) => ({ id: id as SidebarSection, ...config })),
    [settings],
  );

  return (
    <nav
      aria-label={t("a11y.settingsNav")}
      style={{
        width: 224,
        flexShrink: 0,
        height: "100%",
        overflow: "hidden",
        background: "#141414",
        borderRight: "0.5px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="border-b border-white/6 px-[18px] pb-4 pt-5">
        <div className="min-w-0">
          <VocalTypeLogo width={104} />
        </div>
      </div>

      {trialBadge ? (
        <button
          type="button"
          onClick={() =>
            onStartCheckout()
              .then((url) => url && window.open(url, "_blank"))
              .catch(() => {})
          }
          className={`w-full border-b px-[18px] py-2.5 text-left transition-opacity hover:opacity-80 ${
            trialBadge.urgency === "neutral"
              ? "border-logo-primary/15 bg-logo-primary/8"
              : trialBadge.urgency === "warning"
                ? "border-orange-500/20 bg-orange-500/10"
                : "border-red-500/20 bg-red-500/10"
          }`}
        >
          <p
            className={`text-[11px] font-medium leading-tight ${
              trialBadge.urgency === "neutral"
                ? "text-logo-primary"
                : trialBadge.urgency === "warning"
                  ? "text-orange-400"
                  : "text-red-400"
            }`}
          >
            {trialBadge.urgency === "neutral" &&
              t("trial.badge.neutral", {
                count: trialBadge.days,
                defaultValue: "Trial Premium · {{count}}j restants",
              })}
            {trialBadge.urgency === "warning" &&
              t("trial.badge.warning", {
                count: trialBadge.days,
                defaultValue: "Plus que {{count}} jours de Premium",
              })}
            {trialBadge.urgency === "urgent" &&
              (trialBadge.days === 0
                ? t("trial.badge.today", {
                    defaultValue: "Expire aujourd'hui",
                  })
                : t("trial.badge.urgent", {
                    count: trialBadge.days,
                    defaultValue: "Expire dans {{count}} jours",
                  }))}
          </p>
          <p className="mt-1 text-[11px] text-white/42">
            {t("trial.badge.cta", { defaultValue: "Passer à Premium" })}
          </p>
        </button>
      ) : null}

      <TranscriptionWarmupBadge />

      <div className="flex flex-1 flex-col py-2.5 overflow-y-auto">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 18px",
                fontSize: 14,
                width: "100%",
                cursor: "pointer",
                transition: "all 0.15s",
                borderRight: isActive
                  ? "2px solid #c9a84c"
                  : "2px solid transparent",
                background: isActive ? "rgba(201,168,76,0.12)" : "transparent",
                color: isActive ? "#fff" : "rgba(255,255,255,0.58)",
              }}
              onClick={() => onSectionChange(section.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={t(section.labelKey)}
              title={t(section.labelKey)}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
                  isActive ? "text-white" : "text-current"
                }`}
              >
                <Icon
                  width={16}
                  height={16}
                  className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              </span>
              <span
                className="truncate text-[14px] font-medium leading-5"
                title={t(section.labelKey)}
              >
                {t(section.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-white/6 px-[18px] py-3">
        <MachineStatusBar variant="sidebar" />
      </div>
    </nav>
  );
};
