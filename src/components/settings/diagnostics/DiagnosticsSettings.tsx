/* eslint-disable i18next/no-literal-string */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { type } from "@tauri-apps/plugin-os";
import { commands } from "@/bindings";
import { useSettings, useDebouncedSetting } from "../../../hooks/useSettings";
import { authClient } from "@/lib/auth/client";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import type { RuntimeDiagnosticsSnapshot } from "../../../types/runtimeObservability";
import type { LogLevel } from "../../../bindings";
import { Dropdown } from "../../ui/Dropdown";

// ─── Types ────────────────────────────────────────────────────────────────────
type ActionState = "idle" | "loading";
type LogFilter = "all" | "info" | "warn" | "error";
type AnchorId = "snapshot" | "support" | "logs" | "paths" | "runtime" | "lab";

interface VoiceFeedbackInput {
  expected_text: string;
  actual_text: string;
  notes?: string | null;
  selected_language?: string | null;
  tags: string[];
  keep_audio_reference: boolean;
}

const SUPPORT_EMAIL = "contact@vocalype.com";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function summarizeSnapshot(snapshot: RuntimeDiagnosticsSnapshot, _t?: unknown) {
  return [
    `Vocalype ${snapshot.app_version}`,
    `Lifecycle: ${snapshot.lifecycle_state}`,
    `Model: ${snapshot.loaded_model_name ?? snapshot.loaded_model_id ?? snapshot.selected_model}`,
    `Language: ${snapshot.selected_language}`,
    `Microphone: ${snapshot.selected_microphone ?? "n/a"}`,
    `Paste method: ${snapshot.paste_method}`,
    `Input level: ${snapshot.input_level_state}`,
    `Permission: ${snapshot.microphone_permission_state}`,
    `Recent errors: ${snapshot.recent_errors.length}`,
  ].join("\n");
}

function buildFullSupportReport(
  snapshot: RuntimeDiagnosticsSnapshot,
  details: {
    issueSummary: string;
    issueSteps: string;
    expectedBehavior: string;
  },
) {
  return [
    "Vocalype support report",
    "=======================",
    "",
    `Issue summary: ${details.issueSummary || "Not provided"}`,
    "",
    "What happened:",
    details.issueSteps || "Not provided",
    "",
    "Expected behavior:",
    details.expectedBehavior || "Not provided",
    "",
    "Diagnostics summary:",
    `app_version: ${snapshot.app_version}`,
    `captured_at_ms: ${snapshot.captured_at_ms}`,
    `lifecycle_state: ${snapshot.lifecycle_state}`,
    `selected_model: ${snapshot.selected_model}`,
    `loaded_model_id: ${snapshot.loaded_model_id ?? "n/a"}`,
    `selected_language: ${snapshot.selected_language}`,
    `selected_microphone: ${snapshot.selected_microphone ?? "n/a"}`,
    `microphone_permission_state: ${snapshot.microphone_permission_state}`,
    `paste_method: ${snapshot.paste_method}`,
    `input_level_state: ${snapshot.input_level_state}`,
    `recent_errors_count: ${snapshot.recent_errors.length}`,
    `last_audio_error: ${snapshot.last_audio_error ?? "n/a"}`,
    ...(snapshot.recent_errors.length > 0
      ? [
          "",
          "Recent errors:",
          ...snapshot.recent_errors
            .slice(-5)
            .reverse()
            .map((e) => `- [${e.stage}] ${e.code}: ${e.message}`),
        ]
      : []),
  ].join("\n");
}

function formatTs(ms: number) {
  return (
    new Date(ms).toLocaleTimeString("fr-FR", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "." +
    String(ms % 1000).padStart(3, "0")
  );
}

function snapId(ms: number) {
  const d = new Date(ms);
  return `snap_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const PulseRing: React.FC<{ good: boolean }> = ({ good }) => (
  <span
    style={{
      display: "inline-block",
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: good ? "#6cce8c" : "#e8a866",
      boxShadow: `0 0 0 0 ${good ? "rgba(108,206,140,0.6)" : "rgba(232,168,102,0.6)"}`,
      animation: "diagPulse 1.6s ease-out infinite",
    }}
  />
);

const CheckRow: React.FC<{
  label: string;
  meta: string;
  status: "good" | "warn" | "bad";
  val: string;
}> = ({ label, meta, status, val }) => {
  const dotColor =
    status === "good" ? "#6cce8c" : status === "warn" ? "#e8a866" : "#ef5a5a";
  const dotShadow =
    status === "good"
      ? "0 0 0 4px rgba(108,206,140,0.12)"
      : status === "warn"
        ? "0 0 0 4px rgba(232,168,102,0.14)"
        : "0 0 0 4px rgba(239,90,90,0.14)";
  const valColor =
    status === "good" ? "#6cce8c" : status === "warn" ? "#e8a866" : "#ef5a5a";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "22px 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 9,
        background: "#111114",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: dotShadow,
          marginLeft: 7,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#ededee" }}>
          {label}
        </div>
        <div style={{ color: "#82828b", fontSize: 11.5, marginTop: 2 }}>
          {meta}
        </div>
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 12, color: valColor }}>
        {val}
      </span>
    </div>
  );
};

const SectionIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      width: 28,
      height: 28,
      borderRadius: 8,
      background: "rgba(212,168,88,0.14)",
      border: "1px solid rgba(212,168,88,0.32)",
      color: "#d4a858",
      display: "grid",
      placeItems: "center",
      flexShrink: 0,
    }}
  >
    {children}
  </div>
);

const Ic: React.FC<{
  d?: string;
  size?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ size = 14, children, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
  >
    {children}
  </svg>
);

const BtnBase: React.FC<{
  onClick?: () => void;
  disabled?: boolean;
  gold?: boolean;
  danger?: boolean;
  small?: boolean;
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
}> = ({ onClick, disabled, gold, danger, small, children, title, style }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      height: small ? 28 : 32,
      padding: small ? "0 10px" : "0 14px",
      borderRadius: 8,
      border: gold
        ? "none"
        : danger
          ? "1px solid rgba(239,90,90,0.2)"
          : "1px solid rgba(255,255,255,0.06)",
      background: gold ? "#d4a858" : danger ? "transparent" : "#16161a",
      color: gold ? "#1a1306" : danger ? "#ef5a5a" : "#ededee",
      fontFamily: "inherit",
      fontSize: small ? 12 : 13,
      fontWeight: gold ? 600 : 500,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      transition: "background .15s",
      ...style,
    }}
  >
    {children}
  </button>
);

const FieldInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      width: "100%",
      padding: "9px 12px",
      background: "#1c1c22",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 8,
      color: "#ededee",
      fontFamily: "inherit",
      fontSize: 13,
      outline: "none",
    }}
  />
);

const FieldTextarea: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}> = ({ value, onChange, placeholder, rows = 3 }) => (
  <textarea
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    style={{
      width: "100%",
      padding: "9px 12px",
      background: "#1c1c22",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 8,
      color: "#ededee",
      fontFamily: "inherit",
      fontSize: 13,
      outline: "none",
      resize: "vertical",
      lineHeight: 1.5,
    }}
  />
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const DiagnosticsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, isUpdating, audioDevices, getSetting } =
    useSettings();
  const isLinux = type() === "linux";

  // Snapshot
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    null,
  );
  const [snapIdVal, setSnapIdVal] = useState<string>("");
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [status, setStatus] = useState<string | null>(null);

  // Support form
  const [issueSummary, setIssueSummary] = useState("");
  const [issueSteps, setIssueSteps] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");

  // Checklist
  const [checkDone, setCheckDone] = useState<Record<string, boolean>>({});
  const toggleCheck = (k: string) =>
    setCheckDone((p) => ({ ...p, [k]: !p[k] }));

  // Logs
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [logDir, setLogDir] = useState<string | null>(null);

  // Paths copy feedback
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Settings
  const handleThresholdChange = useDebouncedSetting(
    "word_correction_threshold",
    200,
  );
  const handleDelayChange = useDebouncedSetting("paste_delay_ms", 200);
  const currentLogLevel = settings?.log_level ?? "info";
  const wordThreshold = settings?.word_correction_threshold ?? 0.18;
  const pasteDelay = settings?.paste_delay_ms ?? 60;

  // Voice feedback
  const [fbExpected, setFbExpected] = useState("");
  const [fbActual, setFbActual] = useState("");
  const [fbNotes, setFbNotes] = useState("");
  const [fbLang, setFbLang] = useState("");
  const [fbTags, setFbTags] = useState("");
  const [fbKeepAudio, setFbKeepAudio] = useState(false);
  const [fbBusy, setFbBusy] = useState(false);
  const [fbStatus, setFbStatus] = useState<string | null>(null);

  // Anchor scrollspy
  const [activeAnchor, setActiveAnchor] = useState<AnchorId>("snapshot");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<AnchorId, HTMLElement | null>>>({});

  const clearStatusSoon = useCallback(() => {
    window.setTimeout(() => setStatus(null), 3500);
  }, []);

  // Auto-load snapshot on mount
  useEffect(() => {
    void refreshSnapshot();
  }, []);

  // Load log dir
  useEffect(() => {
    commands
      .getLogDirPath()
      .then((r) => {
        if (r.status === "ok") setLogDir(r.data);
      })
      .catch(() => {});
  }, []);

  // Scrollspy
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = el.scrollTop + 140;
        const ids: AnchorId[] = [
          "snapshot",
          "support",
          "logs",
          "paths",
          "runtime",
          "lab",
        ];
        let cur: AnchorId = "snapshot";
        for (const id of ids) {
          const sec = sectionRefs.current[id];
          if (sec && sec.offsetTop <= y) cur = id;
        }
        setActiveAnchor(cur);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const scrollToAnchor = (id: AnchorId) => {
    const sec = sectionRefs.current[id];
    const el = scrollRef.current;
    if (!sec || !el) return;
    el.scrollTo({ top: sec.offsetTop - 110, behavior: "smooth" });
    setActiveAnchor(id);
  };

  const setSecRef = (id: AnchorId) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  // Snapshot helpers
  const getOrRefreshSnapshot =
    async (): Promise<RuntimeDiagnosticsSnapshot> => {
      if (snapshot) return snapshot;
      const r = await commands.getRuntimeDiagnostics();
      if (r.status === "ok") {
        const s = r.data as RuntimeDiagnosticsSnapshot;
        setSnapshot(s);
        setSnapIdVal(snapId(s.captured_at_ms));
        return s;
      }
      throw r.error;
    };

  const refreshSnapshot = async () => {
    setActionState("loading");
    try {
      const r = await commands.getRuntimeDiagnostics();
      if (r.status === "ok") {
        const s = r.data as RuntimeDiagnosticsSnapshot;
        setSnapshot(s);
        setSnapIdVal(snapId(s.captured_at_ms));
        setStatus(
          t("settings.debug.overview.status.refreshed", {
            defaultValue: "Diagnostics refreshed",
          }),
        );
      } else {
        setStatus(getUserFacingErrorMessage(r.error, { t }));
      }
    } catch (e) {
      setStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleCopySummary = async () => {
    setActionState("loading");
    try {
      const s = await getOrRefreshSnapshot();
      await navigator.clipboard.writeText(summarizeSnapshot(s, t));
      setStatus(
        t("settings.debug.overview.status.copied", {
          defaultValue: "Summary copied",
        }),
      );
    } catch (e) {
      setStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleCopyId = async () => {
    if (!snapIdVal) return;
    await navigator.clipboard.writeText(snapIdVal).catch(() => {});
  };

  const handleExportJson = async () => {
    setActionState("loading");
    try {
      const path = await save({
        defaultPath: "vocalype-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) {
        setActionState("idle");
        return;
      }
      const r = await commands.exportRuntimeDiagnostics(path);
      if (r.status === "ok") {
        setStatus(
          t("settings.debug.overview.status.exported", {
            defaultValue: "Diagnostics exported",
          }),
        );
      } else {
        setStatus(getUserFacingErrorMessage(r.error, { t }));
      }
    } catch (e) {
      setStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleExportPackage = async () => {
    setActionState("loading");
    try {
      const s = await getOrRefreshSnapshot();
      const report = buildFullSupportReport(s, {
        issueSummary,
        issueSteps,
        expectedBehavior,
      });
      const path = await save({
        defaultPath: "vocalype-support-package.zip",
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (!path) {
        setActionState("idle");
        return;
      }
      const r = await commands.exportSupportPackage(path, report);
      if (r.status === "ok") {
        setStatus(
          t("settings.debug.overview.status.supportPackageExported", {
            defaultValue: "Support package exported",
          }),
        );
      } else {
        setStatus(getUserFacingErrorMessage(r.error, { t }));
      }
    } catch (e) {
      setStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleContactSupport = async () => {
    setActionState("loading");
    try {
      const s = await getOrRefreshSnapshot();
      const subject = t("settings.debug.overview.support.subject", {
        defaultValue: "Vocalype support request",
      });
      const body = [
        `Issue summary: ${issueSummary || "Not provided"}`,
        "",
        "Hello, I need help with Vocalype. Here is my diagnostics summary:",
        "",
        summarizeSnapshot(s, t),
        "",
        "What I was doing when the issue happened:",
        issueSteps || "",
        "",
        "What I expected instead:",
        expectedBehavior || "",
      ].join("\n");
      window.open(
        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
        "_blank",
      );
      setStatus(
        t("settings.debug.overview.status.supportOpened", {
          defaultValue: "Email draft opened",
        }),
      );
    } catch (e) {
      setStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleOpenLogs = async () => {
    try {
      await commands.openLogDir();
      setStatus(
        t("settings.debug.overview.status.logsOpened", {
          defaultValue: "Log folder opened",
        }),
      );
    } catch (e) {
      setStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      clearStatusSoon();
    }
  };

  const handleCopyPath = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedPath(key);
    window.setTimeout(() => setCopiedPath(null), 1800);
  };

  const handleFbSubmit = async () => {
    setFbBusy(true);
    try {
      const payload: VoiceFeedbackInput = {
        expected_text: fbExpected,
        actual_text: fbActual,
        notes: fbNotes.trim() || null,
        selected_language: fbLang.trim() || null,
        tags: fbTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        keep_audio_reference: fbKeepAudio,
      };
      await invoke("submit_voice_feedback_command", { input: payload });
      setFbStatus(
        t("settings.debug.voiceFeedback.saved", {
          defaultValue: "Voice feedback saved",
        }),
      );
      setFbExpected("");
      setFbActual("");
      setFbNotes("");
      setFbLang("");
      setFbTags("");
      setFbKeepAudio(false);
    } catch (e) {
      setFbStatus(getUserFacingErrorMessage(e, { t }));
    } finally {
      setFbBusy(false);
      window.setTimeout(() => setFbStatus(null), 3000);
    }
  };

  // Derived health state
  const healthGood = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.model_loaded &&
      snapshot.selected_microphone_available &&
      snapshot.microphone_backend_ready &&
      snapshot.recent_errors.length === 0
    );
  }, [snapshot]);

  const logLines = useMemo(() => {
    if (!snapshot) return [];
    const lines: Array<{
      ts: number;
      lvl: "ok" | "info" | "warn" | "err";
      msg: string;
    }> = [];

    // Add recent errors
    for (const err of [...snapshot.recent_errors].reverse().slice(0, 5)) {
      lines.push({
        ts: err.timestamp_ms,
        lvl: "err",
        msg: `[${err.stage}] ${err.code}: ${err.message}`,
      });
    }

    // Add lifecycle event
    if (snapshot.last_lifecycle_event) {
      const ev = snapshot.last_lifecycle_event;
      lines.push({
        ts: ev.timestamp_ms,
        lvl: "info",
        msg: `lifecycle.${ev.state}${ev.detail ? " — " + ev.detail : ""}`,
      });
    }

    // Add a synthetic snapshot entry
    lines.unshift({
      ts: snapshot.captured_at_ms,
      lvl: "ok",
      msg: `snapshot captured id=${snapIdVal || "—"} v${snapshot.app_version}`,
    });

    return lines.sort((a, b) => b.ts - a.ts).slice(0, 20);
  }, [snapshot, snapIdVal]);

  const filteredLogs = useMemo(() => {
    if (logFilter === "all") return logLines;
    return logLines.filter((l) => {
      if (logFilter === "error") return l.lvl === "err";
      if (logFilter === "warn") return l.lvl === "warn";
      if (logFilter === "info") return l.lvl === "info" || l.lvl === "ok";
      return true;
    });
  }, [logLines, logFilter]);

  const LOG_LEVELS: Array<{ value: LogLevel; label: string }> = [
    { value: "error", label: "Error" },
    { value: "warn", label: "Warn" },
    { value: "info", label: "Info" },
    { value: "debug", label: "Debug" },
    { value: "trace", label: "Trace" },
  ];

  const PATHS = useMemo(
    () => [
      {
        id: "logs",
        icon: (
          <Ic size={16}>
            <polyline points="4 17 10 11 14 15 20 9" />
            <polyline points="14 9 20 9 20 15" />
          </Ic>
        ),
        label: t("settings.debug.paths.logs", { defaultValue: "Journaux" }),
        value:
          logDir ??
          (t("common.loading", { defaultValue: "Loading..." }) as string),
        onOpen: handleOpenLogs,
      },
      {
        id: "settings",
        icon: (
          <Ic size={16}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0 1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3 2 2 0 1 1-2.8-2.8 1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8 2 2 0 1 1 2.8-2.8 1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0 1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3 2 2 0 1 1 2.8 2.8 1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4 1.7 1.7 0 0 0-1.5 1z" />
          </Ic>
        ),
        label: t("settings.debug.paths.settings", {
          defaultValue: "Paramètres",
        }),
        value: "%APPDATA%\\vocalype\\settings_store.json",
        onOpen: undefined,
      },
      {
        id: "models",
        icon: (
          <Ic size={16}>
            <path d="M12 2L2 7l10 5 10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </Ic>
        ),
        label: t("settings.debug.paths.models", { defaultValue: "Modèles" }),
        value: "%APPDATA%\\vocalype\\models",
        onOpen: undefined,
      },
    ],
    [logDir, t],
  );

  // Resolve the real microphone name from audioDevices list
  const selectedMicIndex = getSetting("selected_microphone_index") ?? "default";
  const resolvedMicName = useMemo(() => {
    if (!audioDevices || audioDevices.length === 0)
      return snapshot?.selected_microphone ?? "—";
    if (selectedMicIndex === "default" || selectedMicIndex === null) {
      return (
        audioDevices.find((d) => d.is_default)?.name ??
        snapshot?.selected_microphone ??
        "—"
      );
    }
    return (
      audioDevices.find((d) => d.index === selectedMicIndex)?.name ??
      snapshot?.selected_microphone ??
      "—"
    );
  }, [audioDevices, selectedMicIndex, snapshot]);

  const micCheck = snapshot
    ? {
        label: t("settings.debug.diag.mic", { defaultValue: "Microphone" }),
        meta: resolvedMicName,
        status: (snapshot.selected_microphone_available ? "good" : "bad") as
          | "good"
          | "bad",
        val: snapshot.selected_microphone_available
          ? t("settings.debug.diag.active", { defaultValue: "Actif" })
          : t("settings.debug.diag.missing", { defaultValue: "Manquant" }),
      }
    : null;

  const userEmail = authClient.getStoredSession()?.user?.email ?? null;
  const cloudCheck = {
    label: t("settings.debug.diag.cloud", {
      defaultValue: "Service Vocalype Cloud",
    }),
    meta: userEmail ?? "api.vocalype.com",
    status: "good" as const,
    val: t("settings.debug.diag.connected", { defaultValue: "Connecté" }),
  };

  const permCheck = snapshot
    ? {
        label: t("settings.debug.diag.permissions", {
          defaultValue: "Permissions Accessibilité",
        }),
        meta: t("settings.debug.diag.permMeta", {
          defaultValue: "Requise pour l'insertion auto",
        }),
        status: (snapshot.microphone_permission_state === "granted"
          ? "good"
          : "warn") as "good" | "warn",
        val:
          snapshot.microphone_permission_state === "granted"
            ? t("settings.debug.diag.ok", { defaultValue: "OK" })
            : t("settings.debug.diag.check", { defaultValue: "À vérifier" }),
      }
    : null;

  const modelCheck = snapshot
    ? (() => {
        // The model auto-unloads after 15s of inactivity — this is by design.
        // Show green if the model is installed on disk (selected_model is set),
        // regardless of whether it's currently loaded in memory.
        const modelInstalled = !!snapshot.selected_model;
        const modelStatus: "good" | "warn" = modelInstalled ? "good" : "warn";
        const modelVal = modelInstalled
          ? t("settings.debug.diag.installed", { defaultValue: "Installé" })
          : t("settings.debug.diag.notInstalled", {
              defaultValue: "Non installé",
            });
        return {
          label: t("settings.debug.diag.model", { defaultValue: "Modèle IA" }),
          meta: snapshot.loaded_model_name ?? snapshot.selected_model ?? "—",
          status: modelStatus,
          val: modelVal,
        };
      })()
    : null;

  const checkItems = [
    {
      id: "snap",
      label: t("settings.debug.checklist.snap", {
        defaultValue: "Capture récente effectuée",
      }),
      sub: snapshot ? `${snapIdVal}` : "",
      auto: !!snapshot,
    },
    {
      id: "ver",
      label: t("settings.debug.checklist.version", {
        defaultValue: "Version & OS détectés",
      }),
      sub: snapshot ? `${snapshot.app_version}` : "",
      auto: !!snapshot,
    },
    {
      id: "desc",
      label: t("settings.debug.checklist.describe", {
        defaultValue: "Décrire ce qui s'est passé",
      }),
      sub: t("settings.debug.checklist.describeSub", {
        defaultValue: "champs ci-contre",
      }),
      auto: issueSteps.trim().length > 0,
    },
    {
      id: "expected",
      label: t("settings.debug.checklist.expected", {
        defaultValue: "Préciser le comportement attendu",
      }),
      sub: "",
      auto: expectedBehavior.trim().length > 0,
    },
    {
      id: "logs",
      label: t("settings.debug.checklist.logs", {
        defaultValue: "Joindre les logs si demandés",
      }),
      sub: t("settings.debug.checklist.logsSub", {
        defaultValue: "optionnel — Export JSON dans Runtime",
      }),
      auto: false,
    },
  ];

  return (
    <>
      {/* ── Animation keyframes ── */}
      <style>{`
        @keyframes diagRingPulse {
          0%   { transform: scale(0.85); opacity: 0.9; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        @keyframes diagPulse {
          0%   { box-shadow: 0 0 0 0 rgba(108,206,140,0.6); }
          100% { box-shadow: 0 0 0 8px rgba(108,206,140,0); }
        }
        .diag-section { scroll-margin-top: 110px; }
        .diag-anchor { transition: background .12s, color .12s, border-color .12s; }
        .diag-anchor:hover { background: #1c1c22 !important; color: #ededee !important; }
        .diag-anchor.active { background: rgba(212,168,88,0.14) !important; color: #d4a858 !important; border-color: rgba(212,168,88,0.32) !important; }
        .diag-lf.on { color: #ededee !important; background: #24242c !important; border-color: rgba(255,255,255,0.10) !important; }
        .diag-lf:hover { background: #1c1c22 !important; }
        .diag-check-item:hover { background: rgba(255,255,255,0.02); }
        .diag-tool:hover { border-color: rgba(255,255,255,0.10) !important; }
        .diag-path-btn:hover { background: #24242c !important; color: #ededee !important; border-color: rgba(255,255,255,0.10) !important; }
        .diag-snap-copy:hover { color: #d4a858 !important; }
        .diag-head-btn:hover { background: #1c1c22 !important; border-color: rgba(255,255,255,0.10) !important; }
        .diag-gold-btn:hover { background: #e6bd6c !important; }
        .diag-select:hover { background: #24242c !important; border-color: rgba(255,255,255,0.10) !important; }
        input[type="range"].diag-slider { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; outline: none; }
        input[type="range"].diag-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #d4a858; border: 2px solid #1a1306; cursor: pointer; box-shadow: 0 0 0 2px #d4a858; }
        .diag-select:focus { border-color: rgba(212,168,88,0.32) !important; }
        textarea.diag-field:focus, input.diag-field:focus { border-color: rgba(212,168,88,0.32) !important; background: #24242c !important; }
        .diag-send-btn { transition: background .15s; }
      `}</style>

      <div
        ref={scrollRef}
        style={{
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          background:
            "radial-gradient(1200px 600px at 20% -10%, rgba(212,168,88,0.04), transparent 60%), #0a0a0c",
          color: "#ededee",
          fontFamily: "inherit",
          fontSize: 14,
        }}
      >
        {/* ──── Sticky header ──── */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 28px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(10,10,12,0.92)",
            backdropFilter: "blur(12px)",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#82828b",
              fontSize: 12.5,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 26,
                padding: "0 10px",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 7,
                background: "#16161a",
                color: "#b6b6bd",
                fontSize: 12.5,
              }}
            >
              <Ic size={12}>
                <path d="M9 2v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19l-5-11V2" />
                <line x1="9" y1="2" x2="15" y2="2" />
              </Ic>
              {t("settings.debug.title", { defaultValue: "Diagnostics" })}
            </span>
            <span>›</span>
            <span style={{ color: "#b6b6bd" }}>
              {t("settings.debug.overview.title", {
                defaultValue: "Vue d'ensemble",
              })}
            </span>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {status && (
              <span style={{ fontSize: 12, color: "#82828b", marginRight: 4 }}>
                {status}
              </span>
            )}
            <button
              onClick={() => void refreshSnapshot()}
              disabled={actionState === "loading"}
              className="diag-head-btn"
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 8,
                background: "#16161a",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#ededee",
                fontSize: 13,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                cursor: actionState === "loading" ? "not-allowed" : "pointer",
                opacity: actionState === "loading" ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              <Ic size={13}>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <polyline points="21 3 21 8 16 8" />
              </Ic>
              {t("settings.debug.overview.actions.refresh", {
                defaultValue: "Actualiser",
              })}
            </button>
            <button
              onClick={() => void handleCopySummary()}
              disabled={actionState === "loading"}
              className="diag-head-btn"
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 8,
                background: "#16161a",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#ededee",
                fontSize: 13,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                cursor: actionState === "loading" ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              <Ic size={13}>
                <path d="M3 7h13l4 4v6a2 2 0 0 1-2 2H3z" />
                <polyline points="7 12 10 15 17 8" />
              </Ic>
              {t("settings.debug.overview.actions.copySummary", {
                defaultValue: "Copier le résumé",
              })}
            </button>
            <button
              onClick={() => void handleContactSupport()}
              disabled={actionState === "loading"}
              className="diag-gold-btn diag-send-btn"
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 8,
                background: "#d4a858",
                border: "none",
                color: "#1a1306",
                fontSize: 13,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                cursor: actionState === "loading" ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              <Ic size={13} style={{ stroke: "#1a1306", strokeWidth: 2 }}>
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </Ic>
              {t("settings.debug.overview.actions.contactSupport", {
                defaultValue: "Envoyer au support",
              })}
            </button>
          </div>
        </div>

        {/* ──── Page title ──── */}
        <div style={{ padding: "26px 28px 6px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.018em",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            {t("settings.debug.title", { defaultValue: "Diagnostics" })}
            {healthGood !== null && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 22,
                  padding: "0 9px",
                  background: healthGood
                    ? "rgba(108,206,140,0.1)"
                    : "rgba(232,168,102,0.1)",
                  border: `1px solid ${healthGood ? "rgba(108,206,140,0.3)" : "rgba(232,168,102,0.3)"}`,
                  borderRadius: 999,
                  color: healthGood ? "#6cce8c" : "#e8a866",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                }}
              >
                <PulseRing good={healthGood} />
                {healthGood
                  ? t("settings.debug.health.good", {
                      defaultValue: "SYSTÈME OK",
                    })
                  : t("settings.debug.health.warning", {
                      defaultValue: "ATTENTION",
                    })}
              </span>
            )}
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              color: "#82828b",
              fontSize: 13.5,
              lineHeight: 1.55,
              maxWidth: 620,
            }}
          >
            {t("settings.debug.description", {
              defaultValue:
                "Tout ce dont le support a besoin pour t'aider — une capture d'état, les journaux locaux et les outils internes. Capture en un clic, partage en deux.",
            })}
          </p>
        </div>

        {/* ──── Hero ──── */}
        <div
          style={{
            margin: "18px 28px 0",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            background: snapshot
              ? healthGood
                ? "radial-gradient(800px 280px at 90% -50%, rgba(108,206,140,0.08), transparent 60%), linear-gradient(180deg, rgba(108,206,140,0.025), transparent 60%), #16161a"
                : "radial-gradient(800px 280px at 90% -50%, rgba(232,168,102,0.08), transparent 60%), #16161a"
              : "#16161a",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
          }}
        >
          {/* Hero left */}
          <div
            style={{
              padding: "22px 26px",
              borderRight: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {/* Orb */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: "50%",
                    background: snapshot
                      ? healthGood
                        ? "radial-gradient(circle at 50% 40%, rgba(108,206,140,0.3), transparent 60%), radial-gradient(circle at 50% 60%, rgba(108,206,140,0.15), transparent 70%), #1c1c22"
                        : "radial-gradient(circle at 50% 40%, rgba(232,168,102,0.3), transparent 60%), #1c1c22"
                      : "#1c1c22",
                    border: `1px solid ${snapshot ? (healthGood ? "rgba(108,206,140,0.4)" : "rgba(232,168,102,0.4)") : "rgba(255,255,255,0.08)"}`,
                    display: "grid",
                    placeItems: "center",
                    color: snapshot
                      ? healthGood
                        ? "#6cce8c"
                        : "#e8a866"
                      : "#56565e",
                  }}
                >
                  <Ic size={34}>
                    {snapshot && healthGood ? (
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
                    ) : (
                      <path d="M9 2v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19l-5-11V2" />
                    )}
                  </Ic>
                </div>
                {snapshot && (
                  <span
                    style={{
                      position: "absolute",
                      inset: -6,
                      borderRadius: "50%",
                      border: `1px solid ${healthGood ? "rgba(108,206,140,0.25)" : "rgba(232,168,102,0.25)"}`,
                      animation: "diagRingPulse 2.4s ease-out infinite",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11.5,
                    letterSpacing: "0.12em",
                    fontWeight: 600,
                    color: snapshot
                      ? healthGood
                        ? "#6cce8c"
                        : "#e8a866"
                      : "#56565e",
                    textTransform: "uppercase",
                  }}
                >
                  {t("settings.debug.diag.systemState", {
                    defaultValue: "État du système",
                  })}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: "-0.015em",
                    marginTop: 4,
                  }}
                >
                  {!snapshot
                    ? t("settings.debug.health.idle", {
                        defaultValue: "Aucune capture",
                      })
                    : healthGood
                      ? t("settings.debug.health.ok", {
                          defaultValue: "Tout fonctionne normalement",
                        })
                      : t("settings.debug.health.warning", {
                          defaultValue: "Attention recommandée",
                        })}
                </div>
                <div
                  style={{
                    color: "#82828b",
                    fontSize: 13,
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {snapshot
                    ? t("settings.debug.overview.capturedAt", {
                        defaultValue: "Capturé à {{value}}",
                        value: new Date(
                          snapshot.captured_at_ms,
                        ).toLocaleTimeString(),
                      })
                    : t("settings.debug.overview.empty", {
                        defaultValue:
                          "Prenez une capture avant d'envoyer des détails au support.",
                      })}
                </div>
              </div>
            </div>

            {/* Mini stats */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                marginTop: 18,
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                background: "#111114",
              }}
            >
              {[
                {
                  l: t("settings.debug.diag.version", {
                    defaultValue: "Version",
                  }),
                  v: snapshot ? `v${snapshot.app_version}` : "—",
                  good: false,
                },
                {
                  l: t("settings.debug.diag.inputLevel", {
                    defaultValue: "Niveau entrée",
                  }),
                  v: snapshot ? snapshot.input_level_state : "—",
                  good: snapshot?.input_level_state === "healthy",
                },
                {
                  l: t("settings.debug.diag.errors", {
                    defaultValue: "Erreurs récentes",
                  }),
                  v: snapshot ? String(snapshot.recent_errors.length) : "—",
                  good: snapshot?.recent_errors.length === 0,
                },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 14px",
                    borderRight:
                      i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}
                >
                  <div
                    style={{
                      color: "#56565e",
                      fontSize: 10.5,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                    }}
                  >
                    {s.l}
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      marginTop: 4,
                      letterSpacing: "-0.01em",
                      fontFamily: "monospace",
                      color: s.good ? "#6cce8c" : "#ededee",
                    }}
                  >
                    {s.v}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero right — checks */}
          <div
            style={{
              padding: "22px 26px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {snapshot ? (
              <>
                {micCheck && <CheckRow {...micCheck} />}
                <CheckRow {...cloudCheck} />
                {permCheck && <CheckRow {...permCheck} />}
                {modelCheck && <CheckRow {...modelCheck} />}
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  "Microphone",
                  "Service Cloud",
                  "Permissions",
                  "Modèle IA",
                ].map((l) => (
                  <div
                    key={l}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "22px 1fr auto",
                      gap: 10,
                      alignItems: "center",
                      padding: "8px 12px",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 9,
                      background: "#111114",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#56565e",
                        marginLeft: 7,
                        display: "inline-block",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#56565e",
                      }}
                    >
                      {l}
                    </div>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        color: "#56565e",
                      }}
                    >
                      —
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ──── Anchors ──── */}
        <div
          style={{
            margin: "16px 28px 0",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            paddingBottom: 14,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {(
            [
              "snapshot",
              "support",
              "logs",
              "paths",
              "runtime",
              "lab",
            ] as AnchorId[]
          ).map((id) => {
            const labels: Record<AnchorId, string> = {
              snapshot: t("settings.debug.anchor.snapshot", {
                defaultValue: "Capture",
              }),
              support: t("settings.debug.anchor.support", {
                defaultValue: "Support",
              }),
              logs: t("settings.debug.anchor.logs", {
                defaultValue: "Journaux",
              }),
              paths: t("settings.debug.anchor.paths", {
                defaultValue: "Chemins",
              }),
              runtime: t("settings.debug.anchor.runtime", {
                defaultValue: "Runtime",
              }),
              lab: t("settings.debug.anchor.lab", { defaultValue: "Labs" }),
            };
            return (
              <button
                key={id}
                onClick={() => scrollToAnchor(id)}
                className={`diag-anchor${activeAnchor === id ? " active" : ""}`}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  color: "#b6b6bd",
                  fontSize: 12.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {labels[id]}
              </button>
            );
          })}
        </div>

        {/* ──── Content panel ──── */}
        <div style={{ padding: "22px 28px 48px" }}>
          {/* ══ INSTANTANÉ ══ */}
          <div
            ref={setSecRef("snapshot")}
            id="diag-snapshot"
            className="diag-section"
            style={{ marginBottom: 36 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <SectionIcon>
                <Ic size={14}>
                  <rect x="3" y="6" width="18" height="14" rx="2" />
                  <circle cx="12" cy="13" r="4" />
                  <path d="M9 6l1.5-3h3L15 6" />
                </Ic>
              </SectionIcon>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {t("settings.debug.snapshot.title", {
                    defaultValue: "Capture de support",
                  })}
                </div>
                <div style={{ color: "#82828b", fontSize: 12.5, marginTop: 2 }}>
                  {t("settings.debug.snapshot.desc", {
                    defaultValue:
                      "Capture l'état complet de l'app — config, version, perfs, derniers événements.",
                  })}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr",
                gap: 12,
              }}
            >
              {/* Snap card */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#82828b",
                    fontWeight: 600,
                  }}
                >
                  {t("settings.debug.snapshot.latest", {
                    defaultValue: "Dernière capture",
                  })}
                </div>
                {snapIdVal ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: "monospace",
                      fontSize: 13,
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "6px 10px",
                      borderRadius: 7,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {snapIdVal}
                    <button
                      onClick={() => void handleCopyId()}
                      className="diag-snap-copy"
                      style={{
                        color: "#82828b",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        display: "inline-flex",
                      }}
                      title={t("settings.debug.snapshot.copyId", {
                        defaultValue: "Copier l'ID",
                      })}
                    >
                      <Ic size={13}>
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </Ic>
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, color: "#56565e", fontSize: 13 }}>
                    {t("settings.debug.snapshot.empty", {
                      defaultValue: "Aucune capture — cliquez sur Actualiser",
                    })}
                  </div>
                )}

                {snapshot && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)",
                      gap: 12,
                      marginTop: 14,
                    }}
                  >
                    {[
                      {
                        k: t("settings.debug.snapshot.captured", {
                          defaultValue: "Capturé",
                        }),
                        v: new Date(
                          snapshot.captured_at_ms,
                        ).toLocaleTimeString(),
                      },
                      {
                        k: t("settings.debug.snapshot.lifecycle", {
                          defaultValue: "Cycle de vie",
                        }),
                        v: snapshot.lifecycle_state,
                      },
                      {
                        k: t("settings.debug.snapshot.version", {
                          defaultValue: "Version",
                        }),
                        v: `${snapshot.app_version}`,
                      },
                      {
                        k: t("settings.debug.snapshot.model", {
                          defaultValue: "Modèle",
                        }),
                        v:
                          snapshot.loaded_model_name ?? snapshot.selected_model,
                      },
                    ].map(({ k, v }) => (
                      <div key={k}>
                        <div
                          style={{
                            color: "#56565e",
                            fontSize: 11,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}
                        >
                          {k}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#b6b6bd",
                            marginTop: 3,
                            fontFamily: "monospace",
                            wordBreak: "break-all",
                          }}
                        >
                          {v}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 14,
                  }}
                >
                  <BtnBase
                    small
                    onClick={() => void refreshSnapshot()}
                    disabled={actionState === "loading"}
                  >
                    <Ic size={12}>
                      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                      <polyline points="21 3 21 8 16 8" />
                    </Ic>
                    {t("settings.debug.overview.actions.refresh", {
                      defaultValue: "Actualiser",
                    })}
                  </BtnBase>
                  <BtnBase
                    small
                    onClick={() => void handleCopySummary()}
                    disabled={actionState === "loading"}
                  >
                    <Ic size={12}>
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </Ic>
                    {t("settings.debug.overview.actions.copySummary", {
                      defaultValue: "Copier le résumé",
                    })}
                  </BtnBase>
                  <BtnBase
                    small
                    onClick={() => void handleExportJson()}
                    disabled={actionState === "loading"}
                  >
                    <Ic size={12}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </Ic>
                    {t("settings.debug.overview.actions.export", {
                      defaultValue: "Exporter JSON",
                    })}
                  </BtnBase>
                  <BtnBase
                    small
                    onClick={() => void handleExportPackage()}
                    disabled={actionState === "loading"}
                  >
                    <Ic size={12}>
                      <path d="M12 3v12" />
                      <polyline points="6 9 12 15 18 9" />
                      <line x1="4" y1="20" x2="20" y2="20" />
                    </Ic>
                    {t("settings.debug.overview.actions.exportSupportPackage", {
                      defaultValue: "Package complet (.zip)",
                    })}
                  </BtnBase>
                </div>
              </div>

              {/* Send card */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: 18,
                  border: "1px solid rgba(212,168,88,0.32)",
                  borderRadius: 14,
                  background:
                    "linear-gradient(180deg, rgba(212,168,88,0.05), transparent 70%), #16161a",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "#d4a858",
                      fontWeight: 600,
                    }}
                  >
                    {t("settings.debug.snapshot.quickSend", {
                      defaultValue: "Envoi rapide",
                    })}
                  </div>
                  <h3
                    style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700 }}
                  >
                    {t("settings.debug.snapshot.shareTitle", {
                      defaultValue: "Partage avec le support",
                    })}
                  </h3>
                  <p
                    style={{
                      margin: "6px 0 0",
                      color: "#82828b",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {t("settings.debug.snapshot.shareDesc", {
                      defaultValue:
                        "Joint la capture, ton message et un fragment de logs. Ne contient ni audio ni transcription.",
                    })}
                  </p>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "#1c1c22",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 12.5,
                    color: "#b6b6bd",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={snapshot ? "#6cce8c" : "#56565e"}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {snapshot
                    ? t("settings.debug.snapshot.ready", {
                        defaultValue: "Prêt à envoyer",
                      })
                    : t("settings.debug.snapshot.notReady", {
                        defaultValue: "Prenez d'abord une capture",
                      })}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => void handleContactSupport()}
                    disabled={actionState === "loading"}
                    className="diag-gold-btn diag-send-btn"
                    style={{
                      flex: 1,
                      height: 34,
                      borderRadius: 8,
                      border: "none",
                      background: "#d4a858",
                      color: "#1a1306",
                      fontSize: 13,
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      cursor:
                        actionState === "loading" ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <Ic size={13} style={{ stroke: "#1a1306", strokeWidth: 2 }}>
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </Ic>
                    {t("settings.debug.overview.actions.contactSupport", {
                      defaultValue: "Envoyer au support",
                    })}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ══ SUPPORT ══ */}
          <div
            ref={setSecRef("support")}
            id="diag-support"
            className="diag-section"
            style={{ marginBottom: 36 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <SectionIcon>
                <Ic size={14}>
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                </Ic>
              </SectionIcon>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {t("settings.debug.support.title", {
                    defaultValue: "Préparer ton ticket",
                  })}
                </div>
                <div style={{ color: "#82828b", fontSize: 12.5, marginTop: 2 }}>
                  {t("settings.debug.support.desc", {
                    defaultValue:
                      "Un bon ticket = repro court + comportement attendu + capture. Le support a tout en 30 s.",
                  })}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr",
                gap: 12,
              }}
            >
              {/* Form */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <h3
                  style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}
                >
                  {t("settings.debug.support.formTitle", {
                    defaultValue: "Ton message",
                  })}
                </h3>
                <p
                  style={{
                    margin: "0 0 16px",
                    color: "#82828b",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                  }}
                >
                  {t("settings.debug.support.formDesc", {
                    defaultValue:
                      "Soit précis sur ce qui a cassé. Plus c'est court, plus c'est utile.",
                  })}
                </p>

                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#b6b6bd",
                        fontWeight: 500,
                      }}
                    >
                      {t("settings.debug.overview.support.issueSummaryLabel", {
                        defaultValue: "Résumé du problème",
                      })}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#56565e",
                        fontFamily: "monospace",
                      }}
                    >
                      5–10 mots
                    </span>
                  </div>
                  <input
                    className="diag-field"
                    value={issueSummary}
                    onChange={(e) => setIssueSummary(e.target.value)}
                    placeholder={t(
                      "settings.debug.overview.support.issueSummaryPlaceholder",
                      {
                        defaultValue:
                          "Ex. : le collage échoue dans Slack après l'enregistrement",
                      },
                    )}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                      color: "#ededee",
                      fontFamily: "inherit",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#b6b6bd",
                        fontWeight: 500,
                      }}
                    >
                      {t("settings.debug.overview.support.stepsLabel", {
                        defaultValue: "Ce qui s'est passé",
                      })}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#56565e",
                        fontFamily: "monospace",
                      }}
                    >
                      repro
                    </span>
                  </div>
                  <textarea
                    className="diag-field"
                    rows={3}
                    value={issueSteps}
                    onChange={(e) => setIssueSteps(e.target.value)}
                    placeholder={t(
                      "settings.debug.overview.support.stepsPlaceholder",
                      {
                        defaultValue:
                          "J'ai appuyé sur le raccourci dans Slack, parlé 4 s, l'overlay s'est fermé, mais rien n'a été collé.",
                      },
                    )}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                      color: "#ededee",
                      fontFamily: "inherit",
                      fontSize: 13,
                      outline: "none",
                      resize: "vertical",
                      lineHeight: 1.5,
                    }}
                  />
                </div>

                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#b6b6bd",
                        fontWeight: 500,
                      }}
                    >
                      {t("settings.debug.overview.support.expectedLabel", {
                        defaultValue: "Ce que tu attendais",
                      })}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#56565e",
                        fontFamily: "monospace",
                      }}
                    >
                      comportement attendu
                    </span>
                  </div>
                  <textarea
                    className="diag-field"
                    rows={2}
                    value={expectedBehavior}
                    onChange={(e) => setExpectedBehavior(e.target.value)}
                    placeholder={t(
                      "settings.debug.overview.support.expectedPlaceholder",
                      {
                        defaultValue:
                          "Le texte transcrit aurait dû être collé dans le champ actif.",
                      },
                    )}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                      color: "#ededee",
                      fontFamily: "inherit",
                      fontSize: 13,
                      outline: "none",
                      resize: "vertical",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
              </div>

              {/* Checklist */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <h3
                  style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}
                >
                  {t("settings.debug.overview.support.checklistTitle", {
                    defaultValue: "Checklist support",
                  })}
                </h3>
                <p
                  style={{
                    margin: "0 0 16px",
                    color: "#82828b",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                  }}
                >
                  {t("settings.debug.overview.support.checklistDescription", {
                    defaultValue:
                      "Coche au fur et à mesure — tout est prérempli si tu prends une capture.",
                  })}
                </p>

                <div>
                  {checkItems.map((item) => {
                    const done = item.auto || !!checkDone[item.id];
                    return (
                      <div
                        key={item.id}
                        className="diag-check-item"
                        onClick={() => !item.auto && toggleCheck(item.id)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "22px 1fr",
                          gap: 8,
                          padding: "9px 4px",
                          alignItems: "start",
                          borderBottom: "1px dashed rgba(255,255,255,0.06)",
                          cursor: item.auto ? "default" : "pointer",
                          borderRadius: 4,
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            border: done ? "none" : "1.5px solid #56565e",
                            borderRadius: 5,
                            background: done ? "#d4a858" : "transparent",
                            color: done ? "#1a1306" : "transparent",
                            display: "grid",
                            placeItems: "center",
                            marginTop: 1,
                            flexShrink: 0,
                          }}
                        >
                          {done && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <span
                            style={{
                              fontSize: 13,
                              color: done ? "#82828b" : "#b6b6bd",
                              textDecoration: done ? "line-through" : "none",
                              textDecorationColor: "#56565e",
                              lineHeight: 1.45,
                            }}
                          >
                            {item.label}
                          </span>
                          {item.sub && (
                            <div
                              style={{
                                fontSize: 11.5,
                                color: "#56565e",
                                marginTop: 2,
                              }}
                            >
                              {item.sub}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Recent errors */}
                {snapshot && snapshot.recent_errors.length > 0 && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "10px 12px",
                      border: "1px solid rgba(232,168,102,0.2)",
                      borderRadius: 10,
                      background: "rgba(232,168,102,0.06)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "#e8a866",
                        fontWeight: 600,
                      }}
                    >
                      {t("settings.debug.overview.support.recentErrorsTitle", {
                        defaultValue: "Erreurs récentes",
                      })}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {snapshot.recent_errors
                        .slice(-3)
                        .reverse()
                        .map((e) => (
                          <div
                            key={`${e.code}-${e.timestamp_ms}`}
                            style={{
                              fontSize: 12,
                              color: "#b6b6bd",
                              lineHeight: 1.6,
                            }}
                          >
                            [{e.stage}] {e.code}: {e.message}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ══ JOURNAUX ══ */}
          <div
            ref={setSecRef("logs")}
            id="diag-logs"
            className="diag-section"
            style={{ marginBottom: 36 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <SectionIcon>
                <Ic size={14}>
                  <polyline points="4 17 10 11 14 15 20 9" />
                  <polyline points="14 9 20 9 20 15" />
                </Ic>
              </SectionIcon>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {t("settings.debug.logs.title", {
                    defaultValue: "Journaux en direct",
                  })}
                </div>
                <div style={{ color: "#82828b", fontSize: 12.5, marginTop: 2 }}>
                  {t("settings.debug.logs.desc", {
                    defaultValue:
                      "Événements récents — utile quand tu reproduis un bug.",
                  })}
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 14,
                background: "#07070a",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  <Ic size={13}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </Ic>
                  {t("settings.debug.logs.filename", {
                    defaultValue: "vocalype.log",
                  })}
                  {snapshot && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        color: "#6cce8c",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#6cce8c",
                          animation: "diagPulse 1.6s ease-out infinite",
                          display: "inline-block",
                        }}
                      />
                      {t("settings.debug.logs.live", { defaultValue: "live" })}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["all", "info", "warn", "error"] as LogFilter[]).map(
                    (f) => (
                      <button
                        key={f}
                        onClick={() => setLogFilter(f)}
                        className={`diag-lf${logFilter === f ? " on" : ""}`}
                        style={{
                          height: 24,
                          padding: "0 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 500,
                          background: "#1c1c22",
                          border: "1px solid rgba(255,255,255,0.06)",
                          color: "#82828b",
                          fontFamily: "monospace",
                          cursor: "pointer",
                        }}
                      >
                        {f}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 1.7,
                  maxHeight: 280,
                  overflowY: "auto",
                }}
              >
                {!snapshot ? (
                  <div style={{ color: "#56565e", padding: "16px 0" }}>
                    {t("settings.debug.logs.empty", {
                      defaultValue:
                        "Prenez une capture pour voir les événements récents.",
                    })}
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div style={{ color: "#56565e", padding: "16px 0" }}>
                    {t("settings.debug.logs.noMatches", {
                      defaultValue: "Aucun événement pour ce filtre.",
                    })}
                  </div>
                ) : (
                  filteredLogs.map((line, i) => {
                    const lvlColor =
                      line.lvl === "ok"
                        ? "#6cce8c"
                        : line.lvl === "info"
                          ? "#6aa9ef"
                          : line.lvl === "warn"
                            ? "#e8a866"
                            : "#ef5a5a";
                    const lvlLabel =
                      line.lvl === "ok"
                        ? "OK  "
                        : line.lvl === "info"
                          ? "INFO"
                          : line.lvl === "warn"
                            ? "WARN"
                            : "ERR ";
                    return (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "88px 52px 1fr",
                          gap: 12,
                        }}
                      >
                        <span style={{ color: "#56565e" }}>
                          {formatTs(line.ts)}
                        </span>
                        <span style={{ fontWeight: 600, color: lvlColor }}>
                          {lvlLabel}
                        </span>
                        <span style={{ color: "#b6b6bd" }}>{line.msg}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ══ CHEMINS ══ */}
          <div
            ref={setSecRef("paths")}
            id="diag-paths"
            className="diag-section"
            style={{ marginBottom: 36 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <SectionIcon>
                <Ic size={14}>
                  <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H3z" />
                </Ic>
              </SectionIcon>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {t("settings.debug.paths.title", {
                    defaultValue: "Chemins utiles",
                  })}
                </div>
                <div style={{ color: "#82828b", fontSize: 12.5, marginTop: 2 }}>
                  {t("settings.debug.paths.description", {
                    defaultValue:
                      "Les emplacements locaux des journaux, paramètres et modèles.",
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PATHS.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 120px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 14px",
                    background: "#16161a",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "#b6b6bd",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {p.icon}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "#82828b",
                      fontWeight: 600,
                    }}
                  >
                    {p.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12.5,
                      color: "#ededee",
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "6px 10px",
                      borderRadius: 7,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.value}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      className="diag-path-btn"
                      onClick={() => void handleCopyPath(p.value, p.id)}
                      title={t("common.copy", { defaultValue: "Copier" })}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 7,
                        background:
                          copiedPath === p.id
                            ? "rgba(108,206,140,0.1)"
                            : "#1c1c22",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: copiedPath === p.id ? "#6cce8c" : "#82828b",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                    >
                      {copiedPath === p.id ? (
                        <Ic size={13}>
                          <polyline points="20 6 9 17 4 12" />
                        </Ic>
                      ) : (
                        <Ic size={13}>
                          <rect x="9" y="9" width="11" height="11" rx="2" />
                          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                        </Ic>
                      )}
                    </button>
                    {p.onOpen && (
                      <button
                        className="diag-path-btn"
                        onClick={p.onOpen}
                        title={t("common.open", { defaultValue: "Ouvrir" })}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 7,
                          background: "#1c1c22",
                          border: "1px solid rgba(255,255,255,0.06)",
                          color: "#82828b",
                          cursor: "pointer",
                          display: "grid",
                          placeItems: "center",
                          padding: 0,
                        }}
                      >
                        <Ic size={13}>
                          <path d="M14 3h7v7" />
                          <path d="M10 14L21 3" />
                          <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                        </Ic>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ══ RUNTIME ══ */}
          <div
            ref={setSecRef("runtime")}
            id="diag-runtime"
            className="diag-section"
            style={{ marginBottom: 36 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <SectionIcon>
                  <Ic size={14}>
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </Ic>
                </SectionIcon>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {t("settings.debug.runtime.title", {
                      defaultValue: "Outils runtime",
                    })}
                  </div>
                  <div
                    style={{ color: "#82828b", fontSize: 12.5, marginTop: 2 }}
                  >
                    {t("settings.debug.runtime.desc", {
                      defaultValue:
                        "Calibration, debug et inspection en direct du moteur.",
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 10,
              }}
            >
              {/* Log level */}
              <div
                className="diag-tool"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "grid",
                  gridTemplateColumns: "36px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "#1c1c22",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    placeItems: "center",
                    color: "#b6b6bd",
                  }}
                >
                  <Ic size={16}>
                    <polyline points="4 17 10 11 14 15 20 9" />
                  </Ic>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {t("settings.debug.logLevel.title", {
                      defaultValue: "Niveau de journalisation",
                    })}
                    <span
                      style={{
                        fontSize: 9.5,
                        letterSpacing: "0.08em",
                        fontWeight: 600,
                        color: "#6aa9ef",
                        background: "rgba(106,169,239,0.1)",
                        border: "1px solid rgba(106,169,239,0.28)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        textTransform: "uppercase",
                      }}
                    >
                      {currentLogLevel.toUpperCase()}
                    </span>
                  </div>
                  <div
                    style={{
                      color: "#82828b",
                      fontSize: 12,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {t("settings.debug.logLevel.description", {
                      defaultValue: "Définit le détail des logs.",
                    })}
                  </div>
                </div>
                <Dropdown
                  className="min-w-[120px]"
                  selectedValue={currentLogLevel}
                  onSelect={(value) =>
                    void updateSetting("log_level", value as LogLevel)
                  }
                  disabled={!settings || isUpdating("log_level")}
                  options={LOG_LEVELS}
                />
              </div>

              {/* Update checks */}
              <div
                className="diag-tool"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "grid",
                  gridTemplateColumns: "36px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "#1c1c22",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    placeItems: "center",
                    color: "#b6b6bd",
                  }}
                >
                  <Ic size={16}>
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                    <polyline points="21 3 21 8 16 8" />
                  </Ic>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {t("settings.debug.updateChecks.title", {
                      defaultValue: "Vérifier les mises à jour",
                    })}
                  </div>
                  <div
                    style={{
                      color: "#82828b",
                      fontSize: 12,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {t("settings.debug.updateChecks.description", {
                      defaultValue:
                        "Recherche automatiquement les nouvelles versions.",
                    })}
                  </div>
                </div>
                <div
                  onClick={() =>
                    settings &&
                    void updateSetting(
                      "update_checks_enabled",
                      !settings.update_checks_enabled,
                    )
                  }
                  style={{
                    width: 38,
                    height: 22,
                    borderRadius: 999,
                    background: settings?.update_checks_enabled
                      ? "#d4a858"
                      : "#24242c",
                    border: `1px solid ${settings?.update_checks_enabled ? "#d4a858" : "rgba(255,255,255,0.06)"}`,
                    position: "relative",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "background .18s",
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
                      background: settings?.update_checks_enabled
                        ? "#1a1306"
                        : "#d8d8de",
                      transition: "transform .18s",
                      transform: settings?.update_checks_enabled
                        ? "translateX(15px)"
                        : "translateX(0)",
                      display: "inline-block",
                    }}
                  />
                </div>
              </div>

              {/* Word correction threshold */}
              <div
                className="diag-tool"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "grid",
                  gridTemplateColumns: "36px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "#1c1c22",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    placeItems: "center",
                    color: "#b6b6bd",
                  }}
                >
                  <Ic size={16}>
                    <path d="M4 6h16M4 12h10M4 18h13" />
                  </Ic>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {t("settings.debug.wordCorrectionThreshold.title", {
                      defaultValue: "Seuil de correction des mots",
                    })}
                  </div>
                  <div
                    style={{
                      color: "#82828b",
                      fontSize: 12,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {t("settings.debug.wordCorrectionThreshold.description", {
                      defaultValue:
                        "Sensibilité pour les corrections personnalisées.",
                    })}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 180,
                  }}
                >
                  <input
                    type="range"
                    className="diag-slider"
                    min={0}
                    max={1}
                    step={0.01}
                    value={wordThreshold}
                    onChange={(e) =>
                      handleThresholdChange(parseFloat(e.target.value))
                    }
                    style={{
                      width: 120,
                      backgroundImage: `linear-gradient(90deg, #d4a858 0%, #d4a858 ${wordThreshold * 100}%, #1c1c22 ${wordThreshold * 100}%, #1c1c22 100%)`,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: "#b6b6bd",
                      minWidth: 36,
                      textAlign: "right",
                    }}
                  >
                    {wordThreshold.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Paste delay */}
              <div
                className="diag-tool"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "grid",
                  gridTemplateColumns: "36px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "#1c1c22",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    placeItems: "center",
                    color: "#b6b6bd",
                  }}
                >
                  <Ic size={16}>
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 14" />
                  </Ic>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {t("settings.debug.pasteDelay.title", {
                      defaultValue: "Délai de collage",
                    })}
                  </div>
                  <div
                    style={{
                      color: "#82828b",
                      fontSize: 12,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {t("settings.debug.pasteDelay.description", {
                      defaultValue:
                        "Délai avant l'envoi de la touche de collage. Augmente si du mauvais texte est collé.",
                    })}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 180,
                  }}
                >
                  <input
                    type="range"
                    className="diag-slider"
                    min={10}
                    max={200}
                    step={10}
                    value={pasteDelay}
                    onChange={(e) =>
                      handleDelayChange(parseInt(e.target.value, 10))
                    }
                    style={{
                      width: 120,
                      backgroundImage: `linear-gradient(90deg, #d4a858 0%, #d4a858 ${((pasteDelay - 10) / 190) * 100}%, #1c1c22 ${((pasteDelay - 10) / 190) * 100}%, #1c1c22 100%)`,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: "#b6b6bd",
                      minWidth: 48,
                      textAlign: "right",
                    }}
                  >
                    {pasteDelay} ms
                  </span>
                </div>
              </div>

              {/* Cancel shortcut */}
              {!isLinux && (
                <div
                  className="diag-tool"
                  style={{
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "#16161a",
                    borderRadius: 12,
                    padding: "16px 18px",
                    display: "grid",
                    gridTemplateColumns: "36px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: "#1c1c22",
                      border: "1px solid rgba(255,255,255,0.06)",
                      display: "grid",
                      placeItems: "center",
                      color: "#b6b6bd",
                    }}
                  >
                    <Ic size={16}>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                    </Ic>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {t("settings.debug.cancel.title", {
                        defaultValue: "Annulation",
                      })}
                      <span
                        style={{
                          fontSize: 9.5,
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                          color: "#82828b",
                          background: "#1c1c22",
                          border: "1px solid rgba(255,255,255,0.06)",
                          padding: "2px 6px",
                          borderRadius: 4,
                          textTransform: "uppercase",
                        }}
                      >
                        RACCOURCI
                      </span>
                    </div>
                    <div
                      style={{
                        color: "#82828b",
                        fontSize: 12,
                        marginTop: 3,
                        lineHeight: 1.4,
                      }}
                    >
                      {t("settings.debug.cancel.description", {
                        defaultValue:
                          "Touche pour annuler l'enregistrement en cours.",
                      })}
                    </div>
                  </div>
                  <span
                    style={{
                      background: "#1c1c22",
                      padding: "2px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(255,255,255,0.10)",
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: "#ededee",
                    }}
                  >
                    {(
                      settings?.bindings?.["cancel"] as
                        | { current_binding?: string }
                        | undefined
                    )?.current_binding ?? "Esc"}
                  </span>
                </div>
              )}

              {/* Mic diagnostic */}
              <div
                className="diag-tool"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#16161a",
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "grid",
                  gridTemplateColumns: "36px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "#1c1c22",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    placeItems: "center",
                    color: "#b6b6bd",
                  }}
                >
                  <Ic size={16}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9 12l2 2 4-4" />
                  </Ic>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {t("settings.debug.micDiag.title", {
                      defaultValue: "Diagnostic micro",
                    })}
                  </div>
                  <div
                    style={{
                      color: "#82828b",
                      fontSize: 12,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {t("settings.debug.micDiag.description", {
                      defaultValue:
                        "Test rapide de la chaîne audio via la capture runtime.",
                    })}
                  </div>
                </div>
                <BtnBase
                  small
                  onClick={() => void refreshSnapshot()}
                  disabled={actionState === "loading"}
                >
                  {t("settings.debug.micDiag.launch", {
                    defaultValue: "Lancer",
                  })}
                </BtnBase>
              </div>
            </div>
          </div>

          {/* ══ LABS ══ */}
          <div
            ref={setSecRef("lab")}
            id="diag-lab"
            className="diag-section"
            style={{ marginBottom: 8 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <SectionIcon>
                  <Ic size={14}>
                    <path d="M9 2v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19l-5-11V2" />
                    <line x1="9" y1="2" x2="15" y2="2" />
                  </Ic>
                </SectionIcon>
                <div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {t("settings.debug.labs.title", {
                      defaultValue: "Labs · Voice Feedback",
                    })}
                    <span
                      style={{
                        fontSize: 9.5,
                        letterSpacing: "0.08em",
                        fontWeight: 600,
                        color: "#e8a866",
                        background: "rgba(232,168,102,0.1)",
                        border: "1px solid rgba(232,168,102,0.28)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        textTransform: "uppercase",
                      }}
                    >
                      EXPÉRIMENTAL
                    </span>
                  </div>
                  <div
                    style={{ color: "#82828b", fontSize: 12.5, marginTop: 2 }}
                  >
                    {t("settings.debug.labs.desc", {
                      defaultValue:
                        "Aide-nous à améliorer le modèle en signalant des erreurs spécifiques de transcription.",
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid rgba(255,255,255,0.06)",
                background: "#16161a",
                borderRadius: 14,
                padding: 18,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b6b6bd",
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    {t("settings.debug.voiceFeedback.expected", {
                      defaultValue: "Ce que tu voulais dire",
                    })}
                  </div>
                  <FieldTextarea
                    value={fbExpected}
                    onChange={setFbExpected}
                    placeholder={t(
                      "settings.debug.voiceFeedback.expectedPlaceholder",
                      { defaultValue: "Réunion à 14 h 30 avec Alex" },
                    )}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b6b6bd",
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    {t("settings.debug.voiceFeedback.actual", {
                      defaultValue: "Ce que l'app a écrit",
                    })}
                  </div>
                  <FieldTextarea
                    value={fbActual}
                    onChange={setFbActual}
                    placeholder={t(
                      "settings.debug.voiceFeedback.actualPlaceholder",
                      {
                        defaultValue:
                          "Réunion à quatorze heures trente avec Alexis",
                      },
                    )}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b6b6bd",
                      fontWeight: 500,
                      marginBottom: 6,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>
                      {t("settings.debug.voiceFeedback.notes", {
                        defaultValue: "Notes",
                      })}
                    </span>
                    <span
                      style={{
                        color: "#56565e",
                        fontSize: 11,
                        fontFamily: "monospace",
                      }}
                    >
                      contexte
                    </span>
                  </div>
                  <FieldTextarea
                    value={fbNotes}
                    onChange={setFbNotes}
                    placeholder={t(
                      "settings.debug.voiceFeedback.notesPlaceholder",
                      {
                        defaultValue:
                          "Voix basse, pièce bruyante, dérive en français…",
                      },
                    )}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b6b6bd",
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    {t("settings.debug.voiceFeedback.language", {
                      defaultValue: "Langue",
                    })}
                  </div>
                  <FieldInput
                    value={fbLang}
                    onChange={setFbLang}
                    placeholder={t(
                      "settings.debug.voiceFeedback.languagePlaceholder",
                      { defaultValue: "ex. fr ou en" },
                    )}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b6b6bd",
                      fontWeight: 500,
                      marginBottom: 6,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>
                      {t("settings.debug.voiceFeedback.tags", {
                        defaultValue: "Tags",
                      })}
                    </span>
                    <span
                      style={{
                        color: "#56565e",
                        fontSize: 11,
                        fontFamily: "monospace",
                      }}
                    >
                      {t("settings.debug.voiceFeedback.tagsSep", {
                        defaultValue: "séparés par virgule",
                      })}
                    </span>
                  </div>
                  <FieldInput
                    value={fbTags}
                    onChange={setFbTags}
                    placeholder={t(
                      "settings.debug.voiceFeedback.tagsPlaceholder",
                      { defaultValue: "bruit, accent, ponctuation" },
                    )}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    color: "#b6b6bd",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  <div
                    onClick={() => setFbKeepAudio((v) => !v)}
                    style={{
                      width: 16,
                      height: 16,
                      border: fbKeepAudio ? "none" : "1.5px solid #56565e",
                      borderRadius: 4,
                      background: fbKeepAudio ? "#d4a858" : "transparent",
                      color: fbKeepAudio ? "#1a1306" : "transparent",
                      display: "grid",
                      placeItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    {fbKeepAudio && (
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  {t("settings.debug.voiceFeedback.keepAudio", {
                    defaultValue: "Conserver l'audio comme référence",
                  })}
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {fbStatus && (
                    <span style={{ fontSize: 12, color: "#82828b" }}>
                      {fbStatus}
                    </span>
                  )}
                  <BtnBase
                    small
                    onClick={() => {
                      setFbExpected("");
                      setFbActual("");
                      setFbNotes("");
                      setFbLang("");
                      setFbTags("");
                    }}
                    disabled={fbBusy}
                  >
                    {t("common.cancel", { defaultValue: "Annuler" })}
                  </BtnBase>
                  <BtnBase
                    small
                    gold
                    onClick={() => void handleFbSubmit()}
                    disabled={fbBusy || !fbExpected.trim() || !fbActual.trim()}
                  >
                    {t("settings.debug.voiceFeedback.save", {
                      defaultValue: "Enregistrer le feedback",
                    })}
                  </BtnBase>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
