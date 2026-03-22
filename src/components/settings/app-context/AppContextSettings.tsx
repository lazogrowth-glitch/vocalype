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
import Badge from "../../ui/Badge";

// ── Category helpers ──────────────────────────────────────────────────────────

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

type BadgeVariant =
  | "primary"
  | "success"
  | "secondary"
  | "quality"
  | "speed"
  | "experimental";

function categoryBadgeVariant(category: AppContextCategory): BadgeVariant {
  switch (category) {
    case "code":
      return "speed";
    case "email":
      return "primary";
    case "chat":
      return "success";
    case "notes":
      return "secondary";
    case "document":
      return "quality";
    default:
      return "secondary";
  }
}

/** Strip `.exe` suffix and trim for display. */
function displayProcessName(processName: string): string {
  return processName.replace(/\.exe$/i, "");
}

// ── Category select ───────────────────────────────────────────────────────────

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
      className="rounded-[6px] border border-white/10 bg-white/[0.05] px-2 py-1 text-[11.5px] text-white/70 outline-none transition-colors hover:border-white/20 focus:border-logo-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <option value="auto">
        {t("appContext.categories.autoDetected", {
          defaultValue: "Auto (détecté)",
        })}
      </option>
      {CATEGORY_OPTIONS.map((cat) => (
        <option key={cat} value={cat}>
          {categoryLabel(cat, t)}
        </option>
      ))}
    </select>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

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
      // state not yet populated — silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Toggle ────────────────────────────────────────────────────────────────

  const handleToggle = async (value: boolean) => {
    await updateSetting("app_context_enabled", value);
    try {
      await commands.setAppContextEnabled(value);
    } catch {
      // setting written through updateSetting above; this is belt-and-suspenders
    }
  };

  // ── Overrides ─────────────────────────────────────────────────────────────

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
      } else {
        await commands.setAppContextOverride(processName, value);
        setOverrides((prev) => {
          const existing = prev.findIndex(
            (o) => o.process_name === processName,
          );
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = { process_name: processName, category: value };
            return next;
          }
          return [...prev, { process_name: processName, category: value }];
        });
      }
    } catch {
      // silently ignore — UI already shows intent
    }
  };

  const handleRemoveOverride = async (processName: string) => {
    try {
      await commands.removeAppContextOverride(processName);
      setOverrides((prev) =>
        prev.filter((o) => o.process_name !== processName),
      );
    } catch {
      // ignore
    }
  };

  // Overrides that have no corresponding recent app entry (custom entries added by user)
  const standaloneOverrides = overrides.filter(
    (o) => !recentApps.some((r) => r.process_name === o.process_name),
  );

  return (
    <div className="space-y-6 pt-6">
      {/* ── Global toggle ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3">
          <p className="text-[13px] font-medium text-white/80">
            {t("appContext.title", { defaultValue: "Contexte automatique" })}
          </p>
          <p className="mt-0.5 text-[11.5px] text-white/40">
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

      {/* ── Recent apps ────────────────────────────────────────────────────── */}
      <div className={enabled ? "" : "pointer-events-none opacity-40"}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-medium text-white/50">
            {t("appContext.recentApps", { defaultValue: "Apps récentes" })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
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
          <p className="rounded-[8px] border border-white/6 bg-white/[0.02] px-4 py-3 text-[12px] text-white/30">
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
              const displayCategory = currentOverride ?? app.category;

              return (
                <div
                  key={app.process_name}
                  className={`flex items-center gap-3 px-3 py-2.5 ${
                    i < recentApps.length - 1 ? "border-b border-white/6" : ""
                  }`}
                >
                  {/* App name */}
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

                  {/* Detected category badge */}
                  <Badge variant={categoryBadgeVariant(displayCategory)}>
                    {categoryLabel(displayCategory, t)}
                    {currentOverride && (
                      <span className="ml-1 opacity-60">
                        {t("appContext.overrideIndicator", {
                          defaultValue: "(forcé)",
                        })}
                      </span>
                    )}
                  </Badge>

                  {/* Category override selector */}
                  <CategorySelect
                    value={selectValue}
                    onChange={(val) =>
                      handleCategoryChange(app.process_name, val)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Standalone overrides (apps no longer in recent list) ───────────── */}
      {standaloneOverrides.length > 0 && (
        <div className={enabled ? "" : "pointer-events-none opacity-40"}>
          <p className="mb-2 text-[12px] font-medium text-white/50">
            {t("appContext.otherOverrides", {
              defaultValue: "Autres overrides",
            })}
          </p>
          <div className="overflow-hidden rounded-[8px] border border-white/8">
            {standaloneOverrides.map((ov, i) => (
              <div
                key={ov.process_name}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  i < standaloneOverrides.length - 1
                    ? "border-b border-white/6"
                    : ""
                }`}
              >
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-white/70">
                  {displayProcessName(ov.process_name)}
                </p>
                <Badge variant={categoryBadgeVariant(ov.category)}>
                  {categoryLabel(ov.category, t)}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveOverride(ov.process_name)}
                  className="shrink-0 text-white/30 hover:text-red-400"
                  aria-label={t("appContext.removeOverride", {
                    defaultValue: "Remove override",
                  })}
                  title={t("appContext.removeOverride", {
                    defaultValue: "Remove override",
                  })}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <div className="rounded-[8px] border border-white/6 bg-white/[0.02] px-4 py-3">
        <p className="mb-1.5 text-[11px] font-medium text-white/40">
          {t("appContext.howItWorks", {
            defaultValue: "Comment ça fonctionne",
          })}
        </p>
        <ul className="space-y-1 text-[11px] text-white/30">
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
