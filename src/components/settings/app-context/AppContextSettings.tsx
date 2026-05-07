import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RefreshCw, X } from "lucide-react";
import { commands } from "@/bindings";
import type {
  AppContextCategory,
  AppContextOverride,
  RecentAppEntry,
} from "@/bindings";
import { useSettings } from "../../../hooks/useSettings";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Button } from "../../ui/Button";
import { VoiceToCode } from "./VoiceToCode";
const CATEGORY_OPTIONS: AppContextCategory[] = [
  "code",
  "email",
  "chat",
  "document",
  "notes",
  "browser",
  "unknown",
];

function categoryLabel(category: AppContextCategory, t: TFunction): string {
  switch (category) {
    case "code":
      return t("appContext.categories.code", { defaultValue: "Code" });
    case "email":
      return t("appContext.categories.email", { defaultValue: "E-mail" });
    case "chat":
      return t("appContext.categories.chat", { defaultValue: "Chat" });
    case "document":
      return t("appContext.categories.document", { defaultValue: "Document" });
    case "notes":
      return t("appContext.categories.notes", { defaultValue: "Notes" });
    case "browser":
      return t("appContext.categories.browser", { defaultValue: "Navigateur" });
    case "unknown":
      return t("appContext.categories.unknown", { defaultValue: "Inconnu" });
  }
}

function displayProcessName(processName: string): string {
  return processName.replace(/\.exe$/i, "");
}

interface CategorySelectProps {
  value: AppContextCategory | "auto";
  onChange: (value: AppContextCategory | "auto") => void;
  disabled?: boolean;
}

const CategorySelect: React.FC<CategorySelectProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { t } = useTranslation();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as AppContextCategory | "auto")}
      disabled={disabled}
      style={{
        padding: "8px 12px",
        backgroundColor: "rgba(255, 255, 255, 0.05)",
        color: "rgba(255, 255, 255, 0.9)",
        colorScheme: "dark",
      }}
      className="rounded-[6px] border border-white/10 bg-white/[0.05] text-[11.5px] text-white/70 outline-none transition-colors hover:border-white/20 focus:border-logo-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <option
        value="auto"
        style={{ backgroundColor: "#171717", color: "#f5f2ed" }}
      >
        {t("appContext.categories.autoDetected", {
          defaultValue: "Auto (détecté)",
        })}
      </option>
      {CATEGORY_OPTIONS.map((cat) => (
        <option
          key={cat}
          value={cat}
          style={{ backgroundColor: "#171717", color: "#f5f2ed" }}
        >
          {categoryLabel(cat, t)}
        </option>
      ))}
    </select>
  );
};

export const AppContextSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();

  const enabled = (getSetting("app_context_enabled") ?? true) as boolean;

  const [recentApps, setRecentApps] = useState<RecentAppEntry[]>([]);
  const [overrides, setOverrides] = useState<AppContextOverride[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recent, ov] = await Promise.all([
        commands.getRecentApps(),
        commands.listAppContextOverrides(),
      ]);
      setRecentApps(recent);
      setOverrides(ov);
    } catch {
      // State may not be populated yet.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (value: boolean) => {
    await updateSetting("app_context_enabled", value);
    try {
      await commands.setAppContextEnabled(value);
    } catch {
      // Setting was already persisted above.
    }
  };

  const overrideMap = new Map(
    overrides.map((o) => [o.process_name, o.category]),
  );

  const handleCategoryChange = async (
    processName: string,
    value: AppContextCategory | "auto",
  ) => {
    try {
      if (value === "auto") {
        await commands.removeAppContextOverride(processName);
        setOverrides((prev) =>
          prev.filter((o) => o.process_name !== processName),
        );
        return;
      }

      await commands.setAppContextOverride(processName, value);
      setOverrides((prev) => {
        const existing = prev.findIndex((o) => o.process_name === processName);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = { process_name: processName, category: value };
          return next;
        }
        return [...prev, { process_name: processName, category: value }];
      });
    } catch {
      // Keep the UI quiet if the backend is temporarily unavailable.
    }
  };

  const handleRemoveOverride = async (processName: string) => {
    try {
      await commands.removeAppContextOverride(processName);
      setOverrides((prev) =>
        prev.filter((o) => o.process_name !== processName),
      );
    } catch {
      // Ignore transient backend issues here.
    }
  };

  const standaloneOverrides = overrides.filter(
    (o) => !recentApps.some((r) => r.process_name === o.process_name),
  );

  return (
    <div style={{ paddingTop: 8 }}>
      <div>
        <div style={{ marginBottom: 12 }}>
          <p className="text-[13px] font-medium text-white/80">
            {t("appContext.title", { defaultValue: "Contexte automatique" })}
          </p>
          <p style={{ marginTop: 2 }} className="text-[11.5px] text-white/40">
            {t("appContext.description", {
              defaultValue:
                "Adapte la dictée selon l'app active — ton formel pour les e-mails, conversationnel pour le chat, texte brut pour le code.",
            })}
          </p>
        </div>

        <ToggleSwitch
          label={t("appContext.enableToggle", {
            defaultValue: "Adapter la dictée selon l'app active",
          })}
          description={t("appContext.enableToggleDescription", {
            defaultValue:
              "Utilise le contexte de l'application active pour adapter le style de dictée et le post-traitement.",
          })}
          checked={enabled}
          onChange={handleToggle}
          grouped={false}
          descriptionMode="tooltip"
        />
      </div>

      <div
        className={`${enabled ? "" : "pointer-events-none opacity-40"} flex flex-col gap-3`}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-medium text-white/50">
            {t("appContext.recentApps", { defaultValue: "Apps récentes" })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="text-white/30 hover:text-white/60"
            title={t("appContext.refresh", { defaultValue: "Actualiser" })}
          >
            <RefreshCw
              className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>

        {recentApps.length === 0 ? (
          <p
            style={{ padding: "10px 16px" }}
            className="rounded-[8px] border border-white/6 bg-white/[0.02] text-[12px] text-white/30"
          >
            {t("appContext.noRecentApps", {
              defaultValue:
                "Aucune app détectée pour l'instant. Lance une dictée pour remplir cette liste.",
            })}
          </p>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-white/8">
            {recentApps.map((app, i) => {
              const currentOverride = overrideMap.get(app.process_name);
              const selectValue: AppContextCategory | "auto" =
                currentOverride ?? "auto";

              return (
                <div
                  key={app.process_name}
                  style={{ padding: "10px 16px" }}
                  className={`flex items-center gap-3 ${
                    i < recentApps.length - 1 ? "border-b border-white/6" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-white/80">
                      {displayProcessName(app.process_name)}
                    </p>
                    {app.window_title && (
                      <p className="truncate text-[10.5px] text-white/30">
                        {app.window_title}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0">
                    <CategorySelect
                      value={selectValue}
                      onChange={(val) =>
                        void handleCategoryChange(app.process_name, val)
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {standaloneOverrides.length > 0 && (
        <div className={enabled ? "" : "pointer-events-none opacity-40"}>
          <p className="mb-2 text-[12px] font-medium text-white/50">
            {t("appContext.otherOverrides", {
              defaultValue: "Autres règles forcées",
            })}
          </p>
          <div className="overflow-hidden rounded-[8px] border border-white/8">
            {standaloneOverrides.map((ov, i) => (
              <div
                key={ov.process_name}
                style={{ padding: "10px 16px" }}
                className={`flex items-center gap-3 ${
                  i < standaloneOverrides.length - 1
                    ? "border-b border-white/6"
                    : ""
                }`}
              >
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-white/70">
                  {displayProcessName(ov.process_name)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemoveOverride(ov.process_name)}
                  className="shrink-0 text-white/30 hover:text-red-400"
                  aria-label={t("appContext.removeOverride", {
                    defaultValue: "Supprimer la règle",
                  })}
                  title={t("appContext.removeOverride", {
                    defaultValue: "Supprimer la règle",
                  })}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-3" aria-hidden="true" />

      <VoiceToCode />

      <div className="h-3" aria-hidden="true" />

      <div
        style={{ padding: "10px 16px" }}
        className="rounded-[8px] border border-white/6 bg-white/[0.02]"
      >
        <p className="mb-1.5 text-[11px] font-medium text-white/40">
          {t("appContext.howItWorks", {
            defaultValue: "Comment ça fonctionne",
          })}
        </p>
        <ul
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
          className="text-[11px] text-white/30"
        >
          <li>
            <span className="text-white/50">
              {t("appContext.categories.code", { defaultValue: "Code" })}
            </span>
            {" — "}
            {t("appContext.codeHint", {
              defaultValue: "Post-processing désactivé, texte injecté tel quel",
            })}
          </li>
          <li>
            <span className="text-white/50">
              {t("appContext.categories.email", { defaultValue: "E-mail" })}
            </span>
            {" — "}
            {t("appContext.emailHint", {
              defaultValue: "Ton formel, ponctuation complète",
            })}
          </li>
          <li>
            <span className="text-white/50">
              {t("appContext.categories.chat", { defaultValue: "Chat" })}
            </span>
            {" — "}
            {t("appContext.chatHint", {
              defaultValue: "Style conversationnel, ponctuation légère",
            })}
          </li>
          <li>
            <span className="text-white/50">
              {t("appContext.categories.notes", { defaultValue: "Notes" })}
            </span>
            {" — "}
            {t("appContext.notesHint", {
              defaultValue: "Structure markdown préservée",
            })}
          </li>
        </ul>
      </div>
    </div>
  );
};
