import React from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  Clock3,
  FlaskConical,
  History,
  Info,
  LayoutGrid,
  Settings2,
} from "lucide-react";
import VocalTypeLogo from "./icons/VocalTypeLogo";
import { MachineStatusBar } from "./MachineStatusBar";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
} from "./settings";

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

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <aside style={{ width: 210, flexShrink: 0, height: "100%", overflow: "hidden", background: "#141414", borderRight: "0.5px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column" }}>
      <div className="border-b border-white/6 px-[18px] pb-4 pt-5">
        <div className="min-w-0">
          <VocalTypeLogo width={104} />
        </div>
      </div>

      <div className="flex flex-1 flex-col py-2.5">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 18px", fontSize: 13, width: "100%",
                cursor: "pointer", transition: "all 0.15s",
                borderRight: isActive ? "2px solid #c9a84c" : "2px solid transparent",
                background: isActive ? "rgba(201,168,76,0.12)" : "transparent",
                color: isActive ? "#fff" : "rgba(255,255,255,0.45)",
              }}
              onClick={() => onSectionChange(section.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={t(section.labelKey)}
              title={t(section.labelKey)}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
                  isActive
                    ? "text-white"
                    : "text-current"
                }`}
              >
                <Icon
                  width={16}
                  height={16}
                  className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100"
                />
              </span>
              <span
                className="truncate text-[13px] font-normal leading-5"
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
    </aside>
  );
};
