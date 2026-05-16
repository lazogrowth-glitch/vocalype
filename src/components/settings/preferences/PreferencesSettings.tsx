/* eslint-disable i18next/no-literal-string */
import React, { useRef, useCallback, useState, useEffect } from "react";
import {
  Settings2,
  Monitor,
  ClipboardPaste,
  Globe,
  Database,
  Code2,
  Globe2,
  Power,
  Cpu,
  Zap,
  TriangleAlert,
  Trash2,
  RotateCcw,
  Download,
  FolderOpen,
  FileAudio,
  Eye,
  EyeOff,
  Clock,
  Layers,
  ArrowRight,
  Star,
  Server,
  Activity,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { changeAppLanguage, SUPPORTED_LANGUAGES } from "@/i18n";
import { ShortcutInput } from "../ShortcutInput";
import { CustomWords } from "../CustomWords";
import { LanguageSelector } from "../LanguageSelector";
import { TranscriptionEngineCard } from "../advanced/TranscriptionEngineCard";
import { Dropdown } from "../../ui/Dropdown";
import {
  TranscribeFileButton,
  ExportHistoryButton,
  ClearAllHistoryButton,
  OpenRecordingsButton,
} from "../history/HistorySettings";
import { commands } from "@/bindings";
import type { OverlayPosition, RecordingRetentionPeriod } from "@/bindings";
import { usePlan } from "@/lib/subscription/context";

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg0: "#0a0a0c",
  bg1: "#111114",
  bg2: "#16161a",
  bg3: "#1c1c22",
  bg4: "#24242c",
  line: "rgba(255,255,255,0.06)",
  line2: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.94)",
  text2: "rgba(255,255,255,0.64)",
  text3: "rgba(255,255,255,0.38)",
  text4: "rgba(255,255,255,0.22)",
  gold: "#c9a84c",
  gold2: "#e6c96e",
  goldSoft: "rgba(201,168,76,0.14)",
  goldLine: "rgba(201,168,76,0.32)",
  good: "#6cce8c",
  goodSoft: "rgba(108,206,140,0.1)",
  goodLine: "rgba(108,206,140,0.28)",
  danger: "#ef5a5a",
  dangerSoft: "rgba(239,90,90,0.08)",
  dangerLine: "rgba(239,90,90,0.28)",
};

type CatId = "general" | "output" | "transcription" | "data" | "advanced";

function navigateToSettingsSection(section: "debug") {
  window.dispatchEvent(
    new CustomEvent("vocalype:navigate-settings", { detail: section }),
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Animated toggle switch */
const PSwitch: React.FC<{
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ on, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    onClick={() => !disabled && onChange(!on)}
    style={{
      width: 38,
      height: 22,
      borderRadius: 999,
      border: `1px solid ${on ? C.gold : C.line}`,
      background: on ? C.gold : C.bg4,
      position: "relative",
      cursor: disabled ? "not-allowed" : "pointer",
      flexShrink: 0,
      transition: "background .18s, border-color .18s",
      opacity: disabled ? 0.4 : 1,
    }}
  >
    <span
      style={{
        position: "absolute",
        left: 2,
        top: 1,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: on ? "#1a1306" : "#d8d8de",
        transform: on ? "translateX(15px)" : "none",
        transition: "transform .18s, background .18s",
        display: "block",
      }}
    />
  </button>
);

/** 3-column settings row: icon | text | control */
const PRow: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  desc?: string;
  children?: React.ReactNode;
  last?: boolean;
  gold?: boolean;
  danger?: boolean;
  disabled?: boolean;
}> = ({ icon, title, desc, children, last, gold, danger, disabled }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr auto",
      gap: 14,
      alignItems: "center",
      padding: "16px 18px",
      borderBottom: last ? "none" : `1px solid ${C.line}`,
      opacity: disabled ? 0.38 : 1,
      pointerEvents: disabled ? "none" : undefined,
      transition: "opacity .15s",
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 9,
        background: danger
          ? C.dangerSoft
          : gold
            ? `linear-gradient(135deg, rgba(201,168,76,0.18), rgba(201,168,76,0.06))`
            : C.bg3,
        border: `1px solid ${danger ? C.dangerLine : gold ? C.goldLine : C.line}`,
        display: "grid",
        placeItems: "center",
        color: danger ? C.danger : gold ? C.gold : C.text2,
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: danger ? C.danger : C.text,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {title}
      </div>
      {desc && (
        <div
          style={{
            fontSize: 12.5,
            color: C.text3,
            marginTop: 3,
            lineHeight: 1.45,
          }}
        >
          {desc}
        </div>
      )}
    </div>
    {children != null && (
      <div
        style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}
      >
        {children}
      </div>
    )}
  </div>
);

/** Grouped card container */
const PGroup: React.FC<{
  children: React.ReactNode;
  danger?: boolean;
  allowOverflow?: boolean;
}> = ({ children, danger, allowOverflow = false }) => (
  <div
    style={{
      border: `1px solid ${danger ? "rgba(239,90,90,0.18)" : C.line}`,
      borderRadius: 14,
      background: danger
        ? `linear-gradient(180deg, rgba(239,90,90,0.04), transparent 70%), ${C.bg2}`
        : C.bg2,
      overflow: allowOverflow ? "visible" : "hidden",
    }}
  >
    {children}
  </div>
);

/** Section header with icon */
const PSectionHead: React.FC<{
  Icon: React.ComponentType<{
    size?: number | string;
    style?: React.CSSProperties;
    className?: string;
  }>;
  title: string;
  sub?: string;
  aside?: React.ReactNode;
  danger?: boolean;
}> = ({ Icon, title, sub, aside, danger }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: 12,
      gap: 12,
    }}
  >
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: danger ? "rgba(239,90,90,0.1)" : C.goldSoft,
          border: `1px solid ${danger ? "rgba(239,90,90,0.32)" : C.goldLine}`,
          color: danger ? C.danger : C.gold,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <Icon size={14} />
      </div>
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.005em",
            color: danger ? C.danger : C.text,
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            style={{
              fontSize: 12.5,
              color: C.text3,
              marginTop: 2,
              maxWidth: 540,
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
    {aside}
  </div>
);

/** Small pill badge */
const PPill: React.FC<{
  label: string;
  variant?: "default" | "gold" | "good";
}> = ({ label, variant = "default" }) => (
  <span
    style={{
      fontSize: 10,
      letterSpacing: "0.06em",
      fontWeight: 600,
      textTransform: "uppercase",
      color:
        variant === "gold" ? C.gold : variant === "good" ? C.good : C.text3,
      background:
        variant === "gold"
          ? C.goldSoft
          : variant === "good"
            ? C.goodSoft
            : C.bg3,
      border: `1px solid ${variant === "gold" ? C.goldLine : variant === "good" ? C.goodLine : C.line}`,
      padding: "2px 7px",
      borderRadius: 4,
    }}
  >
    {label}
  </span>
);

/** Segmented control */
const PSeg: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}> = ({ options, value, onChange, disabled }) => (
  <div
    style={{
      display: "inline-flex",
      background: C.bg3,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 2,
      opacity: disabled ? 0.38 : 1,
      pointerEvents: disabled ? "none" : undefined,
    }}
  >
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange(opt.value)}
        style={{
          height: 26,
          padding: "0 10px",
          borderRadius: 6,
          color: opt.value === value ? C.text : C.text3,
          fontSize: 12,
          fontWeight: 500,
          background: opt.value === value ? C.bg1 : "transparent",
          boxShadow:
            opt.value === value
              ? "0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.4)"
              : "none",
          transition: "background .12s",
          cursor: "pointer",
          border: "none",
        }}
        onMouseEnter={(e) => {
          if (opt.value === value) return;
          (e.currentTarget as HTMLButtonElement).style.background = C.bg4;
          (e.currentTarget as HTMLButtonElement).style.color = C.text2;
        }}
        onMouseLeave={(e) => {
          if (opt.value === value) return;
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = C.text3;
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

/** Small ghost-danger button */
const PDangerBtn: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ label, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      height: 32,
      padding: "0 14px",
      borderRadius: 8,
      background: "transparent",
      border: `1px solid rgba(239,90,90,0.2)`,
      color: C.danger,
      fontSize: 13,
      fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "background .15s, border-color .15s",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background =
        "rgba(239,90,90,0.08)";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(239,90,90,0.32)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(239,90,90,0.2)";
    }}
  >
    {label}
  </button>
);

const PSubtleBtn: React.FC<{
  label: string;
  onClick: () => void;
}> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      height: 32,
      padding: "0 14px",
      borderRadius: 8,
      background: C.bg3,
      border: `1px solid ${C.line}`,
      color: C.text,
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      transition: "background .15s, border-color .15s",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = C.bg4;
      (e.currentTarget as HTMLButtonElement).style.borderColor = C.line2;
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = C.bg3;
      (e.currentTarget as HTMLButtonElement).style.borderColor = C.line;
    }}
  >
    {label}
  </button>
);

/** Section anchor wrapper */
const PSection: React.FC<{
  id: CatId;
  children: React.ReactNode;
}> = ({ id, children }) => (
  <div id={`psec-${id}`} style={{ marginBottom: 28, scrollMarginTop: 90 }}>
    {children}
  </div>
);

// ── Strip of action buttons (Données section) ──────────────────────────────

// ── Main component ─────────────────────────────────────────────────────────
export const PreferencesSettings: React.FC = () => {
  const { settings, getSetting, updateSetting, isUpdating } = useSettings();
  const { capabilities, openUpgradePlans } = usePlan();
  const mainRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [activeCat, setActiveCat] = useState<CatId>("general");

  const SECTION_LABELS: Record<CatId, string> = {
    general: "Général",
    transcription: "Dictée",
    output: "Sortie texte",
    data: "Données & confidentialité",
    advanced: "Avancé",
  };

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const y = el.scrollTop + 130;
        const ids: CatId[] = [
          "general",
          "transcription",
          "output",
          "data",
          "advanced",
        ];
        let cur: CatId = "general";
        ids.forEach((id) => {
          const sec = document.getElementById(`psec-${id}`);
          if (sec && sec.offsetTop <= y) cur = id;
        });
        setActiveCat(cur);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleOpenRecordingsFolder = useCallback(async () => {
    try {
      await commands.openRecordingsFolder();
    } catch {}
  }, []);

  // ── Derived settings ─────────────────────────────────────────────────────
  const autostartOn = (getSetting("autostart_enabled") ?? false) as boolean;
  const trayOn = (getSetting("show_tray_icon") ?? true) as boolean;
  const overlayPos = (getSetting("overlay_position") ??
    "bottom") as OverlayPosition;
  const autoSubmitOn = (getSetting("auto_submit") ?? false) as boolean;
  const trailingSpaceOn = (getSetting("append_trailing_space") ??
    false) as boolean;
  const adaptiveVocabOn = (getSetting("adaptive_vocabulary_enabled") ??
    false) as boolean;
  const debugModeOn = (getSetting("debug_mode") ?? false) as boolean;
  const retentionPeriod = (getSetting("recording_retention_period") ??
    "weeks_2") as RecordingRetentionPeriod;
  const saveAudioOn = (getSetting("save_audio_recordings") ?? false) as boolean;
  const updateChecksOn = (getSetting("update_checks_enabled") ??
    true) as boolean;

  const currentAppLang = (settings?.app_language ?? "fr") as string;

  const cloudActive =
    settings?.post_process_enabled === true &&
    settings?.post_process_provider_id === "vocalype-cloud";

  // ── Retention options ────────────────────────────────────────────────────
  const retentionOptions = [
    { value: "days_3", label: "3 jours" },
    { value: "weeks_2", label: "2 sem." },
    { value: "months_3", label: "3 mois" },
    { value: "preserve_limit", label: "Toujours" },
  ];

  // ── Update check options ─────────────────────────────────────────────────
  const updateOptions = [
    { value: "auto", label: "Auto" },
    { value: "manual", label: "Manuel" },
  ];

  const overlayOptions = [
    { value: "none", label: "Aucun" },
    { value: "bottom", label: "Bas" },
    { value: "top", label: "Haut" },
  ];

  return (
    <div
      style={{
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Main content ───────────────────────────────────────────────── */}
      <section
        ref={mainRef}
        style={{
          height: "100%",
          background: C.bg1,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Sticky header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 24px",
            borderBottom: `1px solid ${C.line}`,
            position: "sticky",
            top: 0,
            background: C.bg1,
            zIndex: 5,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: C.text3,
            }}
          >
            <Settings2 size={12} />
            <span>Paramètres</span>
            <span style={{ color: C.text4 }}>›</span>
            <span style={{ color: C.text2, fontWeight: 600 }}>
              {SECTION_LABELS[activeCat]}
            </span>
          </div>
        </div>

        {/* All sections */}
        <div style={{ padding: "22px 28px 32px" }}>
          {/* ── GÉNÉRAL ─────────────────────────────────────────────────── */}
          <PSection id="general">
            <PSectionHead Icon={Settings2} title="Général" />
            <PGroup allowOverflow>
              <PRow
                gold
                icon={<Globe2 size={16} />}
                title="Langue de l'application"
                desc="Change la langue de l'interface Vocalype. Un redémarrage est nécessaire pour appliquer."
              >
                <Dropdown
                  className="min-w-[150px]"
                  selectedValue={currentAppLang}
                  onSelect={(value) => {
                    void changeAppLanguage(value);
                    void updateSetting("app_language", value);
                  }}
                  disabled={isUpdating("app_language")}
                  options={SUPPORTED_LANGUAGES.map((language) => ({
                    value: language.code,
                    label: language.nativeName,
                  }))}
                />
              </PRow>

              <PRow
                icon={<Power size={16} />}
                title="Lancer au démarrage"
                desc="Démarre Vocalype en arrière-plan à l'ouverture de session."
              >
                <PSwitch
                  on={autostartOn}
                  onChange={(v) => {
                    void updateSetting("autostart_enabled", v);
                    void updateSetting("start_hidden", v);
                  }}
                  disabled={isUpdating("autostart_enabled")}
                />
              </PRow>

              <PRow
                icon={<Layers size={16} />}
                title="Icône dans la barre des tâches"
                desc="Affiche l'icône Vocalype dans le system tray pour un accès rapide."
              >
                <PSwitch
                  on={trayOn}
                  onChange={(v) => void updateSetting("show_tray_icon", v)}
                  disabled={isUpdating("show_tray_icon")}
                />
              </PRow>

              <PRow
                icon={<Activity size={16} />}
                title="Vérifier les mises à jour"
                desc="Choisis si Vocalype vérifie automatiquement les nouvelles versions."
              >
                <PSeg
                  options={updateOptions}
                  value={updateChecksOn ? "auto" : "manual"}
                  onChange={(v) =>
                    void updateSetting("update_checks_enabled", v !== "manual")
                  }
                />
              </PRow>

              <PRow
                icon={<Monitor size={16} />}
                title="Position de l'overlay"
                desc="Retour visuel affiché pendant l'enregistrement."
              >
                <PSeg
                  options={overlayOptions}
                  value={overlayPos}
                  onChange={(v) =>
                    void updateSetting("overlay_position", v as OverlayPosition)
                  }
                />
              </PRow>

              <PRow
                last
                icon={<Eye size={16} />}
                title="Overlay activé"
                desc="Affiche l'overlay pendant la dictée."
              >
                <PSwitch
                  on={overlayPos !== "none"}
                  onChange={(v) =>
                    void updateSetting(
                      "overlay_position",
                      v ? "bottom" : "none",
                    )
                  }
                  disabled={isUpdating("overlay_position")}
                />
              </PRow>
            </PGroup>
          </PSection>

          {/* ── DICTÉE ───────────────────────────────────────────────────── */}
          <PSection id="transcription">
            <PSectionHead Icon={Globe} title="Dictée" />
            <PGroup>
              {/* Language selector */}
              <div
                style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr",
                    gap: 14,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: `linear-gradient(135deg, rgba(201,168,76,0.18), rgba(201,168,76,0.06))`,
                      border: `1px solid ${C.goldLine}`,
                      display: "grid",
                      placeItems: "center",
                      color: C.gold,
                    }}
                  >
                    <Globe size={16} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      Langue parlée
                    </div>
                    <div
                      style={{ fontSize: 12.5, color: C.text3, marginTop: 3 }}
                    >
                      Auto détermine automatiquement la langue.
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, paddingLeft: 50 }}>
                  <LanguageSelector grouped={false} />
                </div>
              </div>

              {/* Language toggle shortcut */}
              <div
                style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr",
                    gap: 14,
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: C.bg3,
                      border: `1px solid ${C.line}`,
                      display: "grid",
                      placeItems: "center",
                      color: C.text2,
                    }}
                  >
                    <Globe2 size={16} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      Bascule de langue
                    </div>
                    <div
                      style={{ fontSize: 12.5, color: C.text3, marginTop: 3 }}
                    >
                      Cycle entre les langues de transcription.
                    </div>
                  </div>
                </div>
                <div style={{ paddingLeft: 50 }}>
                  <ShortcutInput shortcutId="toggle_language" grouped={false} />
                </div>
              </div>

              {/* Custom words */}
              <div
                style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr",
                    gap: 14,
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: C.bg3,
                      border: `1px solid ${C.line}`,
                      display: "grid",
                      placeItems: "center",
                      color: C.text2,
                    }}
                  >
                    <Star size={16} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      Mots personnalisés{" "}
                      <PPill
                        label={String((settings?.custom_words ?? []).length)}
                      />
                    </div>
                    <div
                      style={{ fontSize: 12.5, color: C.text3, marginTop: 3 }}
                    >
                      Vocalype corrigera les mots similaires pour correspondre à
                      ta liste.
                    </div>
                  </div>
                </div>
                <div style={{ paddingLeft: 50 }}>
                  <CustomWords descriptionMode="tooltip" grouped={false} />
                </div>
              </div>

              {/* Adaptive vocabulary */}
              <PRow
                icon={<Cpu size={16} />}
                title={
                  <>
                    Apprends mes mots{" "}
                    <PPill
                      label={adaptiveVocabOn ? "Actif" : "Inactif"}
                      variant={adaptiveVocabOn ? "good" : "default"}
                    />
                  </>
                }
                desc="Mémorise les termes que tu utilises souvent pour améliorer la précision."
              >
                <PSwitch
                  on={adaptiveVocabOn}
                  onChange={(v) =>
                    void updateSetting("adaptive_vocabulary_enabled", v)
                  }
                  disabled={isUpdating("adaptive_vocabulary_enabled")}
                />
              </PRow>

              <div
                id="cloud-post-process-toggle"
                style={{ scrollMarginTop: 120 }}
              >
                <PRow
                  gold={cloudActive}
                  icon={<Zap size={16} />}
                  title={
                    <>
                      Vocalype Cloud{" "}
                      <PPill
                        label={cloudActive ? "Actif" : "Inactif"}
                        variant={cloudActive ? "good" : "default"}
                      />
                    </>
                  }
                  desc="Post-traitement IA sur nos serveurs — reformule, ponctue, corrige."
                >
                  <PSwitch
                    on={cloudActive}
                    onChange={(v) =>
                      void updateSetting("post_process_enabled", v)
                    }
                  />
                </PRow>
              </div>

              <PRow
                last
                icon={<EyeOff size={16} />}
                title="Mode privé"
                desc="Désactive le post-traitement IA. Tout reste local, rien ne sort."
              >
                <PSwitch
                  on={!settings?.post_process_enabled}
                  onChange={(v) =>
                    void updateSetting("post_process_enabled", !v)
                  }
                />
              </PRow>
            </PGroup>
          </PSection>

          {/* ── SORTIE TEXTE ─────────────────────────────────────────────── */}
          <PSection id="output">
            <PSectionHead Icon={ClipboardPaste} title="Sortie texte" />
            <PGroup allowOverflow>
              <PRow
                icon={<ClipboardPaste size={16} />}
                title="Méthode d'insertion"
                desc="Coller (rapide, recommandé) ou Frappe simulée."
              >
                <Dropdown
                  className="min-w-[150px]"
                  selectedValue={(settings?.paste_method ?? "ctrl_v") as string}
                  onSelect={(value) =>
                    void updateSetting(
                      "paste_method",
                      value as import("@/bindings").PasteMethod,
                    )
                  }
                  disabled={isUpdating("paste_method")}
                  options={[
                    { value: "ctrl_v", label: "Ctrl+V" },
                    { value: "shift_insert", label: "Shift+Insert" },
                    { value: "direct", label: "Direct" },
                    { value: "none", label: "Désactivé" },
                  ]}
                />
              </PRow>

              <PRow
                icon={<ArrowRight size={16} />}
                title="Envoyer après collage"
                desc="Appuie sur Entrée après le collage — utile pour envoyer un message."
              >
                <PSwitch
                  on={autoSubmitOn}
                  onChange={(v) => void updateSetting("auto_submit", v)}
                  disabled={isUpdating("auto_submit")}
                />
              </PRow>

              <PRow
                last
                icon={<Star size={16} />}
                title="Espace après collage"
                desc="Ajoute un espace après le texte collé pour que le mot suivant commence proprement."
              >
                <PSwitch
                  on={trailingSpaceOn}
                  onChange={(v) =>
                    void updateSetting("append_trailing_space", v)
                  }
                  disabled={isUpdating("append_trailing_space")}
                />
              </PRow>
            </PGroup>
          </PSection>

          {/* ── DONNÉES & CONFIDENTIALITÉ ────────────────────────────────── */}
          <PSection id="data">
            <PSectionHead Icon={Database} title="Données & confidentialité" />
            <PGroup>
              <PRow
                icon={<Clock size={16} />}
                title="Sauvegarder l'audio"
                desc="Active pour réécouter les enregistrements dans l'historique. ~32 KB/s de dictée."
              >
                <PSwitch
                  on={saveAudioOn}
                  onChange={(v) =>
                    void updateSetting("save_audio_recordings", v)
                  }
                />
              </PRow>

              <PRow
                icon={<Clock size={16} />}
                title="Conserver l'audio"
                desc="Durée de conservation avant suppression automatique."
                disabled={!saveAudioOn}
              >
                <PSeg
                  options={retentionOptions}
                  value={retentionPeriod}
                  disabled={!saveAudioOn}
                  onChange={(v) =>
                    void updateSetting(
                      "recording_retention_period",
                      v as RecordingRetentionPeriod,
                    )
                  }
                />
              </PRow>

              <PRow
                icon={<FileAudio size={16} />}
                title="Transcrire un fichier"
                desc="Importe un fichier WAV ou FLAC et copie la transcription."
              >
                <TranscribeFileButton
                  disabled={!capabilities.canImportAudioFiles}
                  onUpgrade={openUpgradePlans}
                />
              </PRow>

              <PRow
                icon={<Download size={16} />}
                title="Exporter mes données"
                desc="Télécharge toutes tes transcriptions en TXT, CSV ou JSON."
              >
                <ExportHistoryButton
                  allowedFormats={capabilities.exportFormats}
                  onUpgrade={openUpgradePlans}
                />
              </PRow>

              <PRow
                last
                icon={<FolderOpen size={16} />}
                title="Dossier d'enregistrements"
                desc="Ouvre le dossier contenant tes fichiers audio."
              >
                <OpenRecordingsButton
                  onClick={() => void handleOpenRecordingsFolder()}
                  label="Ouvrir"
                />
              </PRow>
            </PGroup>
          </PSection>

          {/* ── AVANCÉ ──────────────────────────────────────────────────── */}
          <PSection id="advanced">
            <PSectionHead Icon={Code2} title="Avancé" />
            <PGroup>
              <TranscriptionEngineCard />

              <PRow
                icon={<Activity size={16} />}
                title="Diagnostics"
                desc="Ouvre les outils de support et de depannage dans une page separee."
              >
                <PSubtleBtn
                  label="Ouvrir"
                  onClick={() => navigateToSettingsSection("debug")}
                />
              </PRow>

              <PRow
                icon={<Activity size={16} />}
                title="Logs détaillés"
                desc="Active les logs verbeux pour le diagnostic. Désactive en utilisation normale."
              >
                <PSwitch
                  on={debugModeOn}
                  onChange={(v) => void updateSetting("debug_mode", v)}
                  disabled={isUpdating("debug_mode")}
                />
              </PRow>

              <PRow
                last
                icon={<Server size={16} />}
                title="Mode expérimental"
                desc="Active les fonctionnalités expérimentales en cours de développement."
              >
                <PSwitch
                  on={(settings?.experimental_enabled ?? false) as boolean}
                  onChange={(v) =>
                    void updateSetting("experimental_enabled", v)
                  }
                  disabled={isUpdating("experimental_enabled")}
                />
              </PRow>
            </PGroup>

            <div style={{ marginTop: 24 }}>
              <PSectionHead
                Icon={TriangleAlert}
                title="Zone dangereuse"
                danger
              />
              <PGroup danger>
                <PRow
                  danger
                  icon={<Trash2 size={16} />}
                  title="Effacer tout l'historique"
                  desc="Supprime toutes les transcriptions, fichiers audio et statistiques."
                >
                  <ClearAllHistoryButton onCleared={() => {}} />
                </PRow>
                <PRow
                  last
                  danger
                  icon={<RotateCcw size={16} />}
                  title="Réinitialiser les paramètres"
                  desc="Remet tous les réglages aux valeurs par défaut. Tes profils ne sont pas touchés."
                >
                  <PDangerBtn
                    label="Réinitialiser"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remettre tous les paramètres aux valeurs par défaut ?",
                        )
                      ) {
                        void commands.resetAllSettings();
                      }
                    }}
                  />
                </PRow>
              </PGroup>
            </div>
          </PSection>
        </div>
      </section>
    </div>
  );
};
