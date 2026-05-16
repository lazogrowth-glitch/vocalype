/* eslint-disable i18next/no-literal-string */
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  commands,
  type AppSettings,
  type DictionaryEntry,
  type HistoryEntry,
  type HistoryStats,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { LANGUAGES } from "@/lib/constants/languages";
import { getKeyName, normalizeKey } from "@/lib/utils/keyboard";
import { useOsType } from "@/hooks/useOsType";
import "./DictationSettings.css";

// ── Waveform — CSS animation au repos, audio réel quand actif ─────────────────
interface WaveFormProps {
  analyser?: AnalyserNode | null;
}
const WaveForm: React.FC<WaveFormProps> = ({ analyser }) => {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);

  const barConfigs = useMemo(
    () => Array.from({ length: 28 }, (_, i) => ({ key: i })),
    [],
  );

  useEffect(() => {
    if (!analyser) {
      // Restore CSS animation
      barsRef.current.forEach((bar) => {
        if (bar) {
          bar.style.animationName = "";
          bar.style.height = "";
        }
      });
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const n = 28;

    const animate = () => {
      analyser.getByteFrequencyData(dataArray);
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const start = Math.floor((i / n) * bufferLength * 0.65);
        const end = Math.max(
          start + 1,
          Math.floor(((i + 1) / n) * bufferLength * 0.65),
        );
        let sum = 0;
        for (let j = start; j < end; j++) sum += dataArray[j];
        const avg = sum / (end - start);
        const h = 18 + (avg / 255) * 72; // 18%→90%
        bar.style.height = `${h}%`;
        bar.style.animationName = "none";
        bar.style.opacity = String(0.45 + (avg / 255) * 0.55);
      });
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      barsRef.current.forEach((bar) => {
        if (bar) {
          bar.style.animationName = "";
          bar.style.height = "";
        }
      });
    };
  }, [analyser]);

  return (
    <div
      style={{
        marginTop: 12,
        height: 36,
        display: "flex",
        alignItems: "center",
        gap: 3,
      }}
    >
      {barConfigs.map((b, i) => (
        <div
          key={b.key}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="bar"
        />
      ))}
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatBinding(binding: string): string[] {
  if (!binding) return [];
  return binding.split("+").map((k) => {
    switch (k.toLowerCase()) {
      case "ctrl":
      case "control":
        return "Ctrl";
      case "alt":
        return "Alt";
      case "shift":
        return "Shift";
      case "space":
        return "Space";
      case "meta":
      case "super":
      case "cmd":
        return "⌘";
      case "win":
        return "Win";
      default:
        return k.charAt(0).toUpperCase() + k.slice(1);
    }
  });
}

function fmtRelTime(ts: number): string {
  const ms = ts * 1000;
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "hier";
  if (diffD < 7)
    return ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."][
      new Date(ms).getDay()
    ];
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function fmtNum(n: number): string {
  return n.toLocaleString("fr-FR");
}

// ── DictationSettings ──────────────────────────────────────────────────────────
export const DictationSettings: React.FC = () => {
  // ── Real settings ──────────────────────────────────────────────────────────
  const { getSetting, updateSetting, audioDevices, updateBinding } =
    useSettings();
  const osType = useOsType();

  const pushToTalk = getSetting("push_to_talk") ?? false;
  const alwaysOn = getSetting("always_on_microphone") ?? false;
  const bindings = getSetting("bindings") ?? {};
  const transcribeBinding =
    (bindings as Record<string, { current_binding?: string }>)["transcribe"]
      ?.current_binding ?? "";
  const selectedMicIndex = getSetting("selected_microphone_index") ?? "default";

  const micName = useMemo(() => {
    if (!selectedMicIndex || selectedMicIndex === "default") {
      return (
        audioDevices.find((d) => d.is_default)?.name ?? "Microphone par défaut"
      );
    }
    return (
      audioDevices.find((d) => d.index === selectedMicIndex)?.name ??
      "Microphone"
    );
  }, [audioDevices, selectedMicIndex]);

  const currentMode: "bascule" | "ptt" | "vad" = pushToTalk
    ? "ptt"
    : alwaysOn
      ? "vad"
      : "bascule";

  const modeName =
    currentMode === "ptt"
      ? "Tenir"
      : currentMode === "vad"
        ? "Toujours actif"
        : "Bascule";

  const shortcutParts = useMemo(
    () => formatBinding(transcribeBinding),
    [transcribeBinding],
  );

  // ── Shortcut capture ───────────────────────────────────────────────────────
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturePressed, setCapturePressed] = useState<string[]>([]);
  const [captureRecorded, setCaptureRecorded] = useState<string[]>([]);
  const captureRef = useRef<HTMLDivElement>(null);

  const cancelCapture = useCallback(async () => {
    await commands.resumeBinding("transcribe").catch(() => {});
    setIsCapturing(false);
    setCapturePressed([]);
    setCaptureRecorded([]);
  }, []);

  const startCapture = useCallback(async () => {
    await commands.suspendBinding("transcribe").catch(() => {});
    setCapturePressed([]);
    setCaptureRecorded([]);
    setIsCapturing(true);
  }, []);

  useEffect(() => {
    if (!isCapturing) return;

    const MODIFIERS = [
      "ctrl",
      "control",
      "shift",
      "alt",
      "option",
      "meta",
      "command",
      "cmd",
      "super",
      "win",
      "windows",
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      if (e.key === "Escape") {
        void cancelCapture();
        return;
      }
      const key = normalizeKey(getKeyName(e, osType));
      setCapturePressed((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setCaptureRecorded((prev) =>
        prev.includes(key) ? prev : [...prev, key],
      );
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      e.preventDefault();
      const key = normalizeKey(getKeyName(e, osType));
      const nextPressed = capturePressed.filter((k) => k !== key);
      setCapturePressed(nextPressed);
      if (nextPressed.length === 0 && captureRecorded.length > 0) {
        const sorted = [...captureRecorded].sort((a, b) => {
          const aM = MODIFIERS.includes(a.toLowerCase());
          const bM = MODIFIERS.includes(b.toLowerCase());
          return aM === bM ? 0 : aM ? -1 : 1;
        });
        const newShortcut = sorted.join("+");
        await updateBinding("transcribe", newShortcut).catch(() => {});
        await commands.resumeBinding("transcribe").catch(() => {});
        setIsCapturing(false);
        setCapturePressed([]);
        setCaptureRecorded([]);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        captureRef.current &&
        !captureRef.current.contains(e.target as Node)
      ) {
        void cancelCapture();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [
    isCapturing,
    capturePressed,
    captureRecorded,
    osType,
    cancelCapture,
    updateBinding,
  ]);

  const handleModeSelect = useCallback(
    async (id: "bascule" | "ptt" | "vad") => {
      switch (id) {
        case "ptt":
          await updateSetting("push_to_talk", true);
          await updateSetting("always_on_microphone", false);
          break;
        case "vad":
          await updateSetting("push_to_talk", false);
          await updateSetting("always_on_microphone", true);
          break;
        default:
          await updateSetting("push_to_talk", false);
          await updateSetting("always_on_microphone", false);
      }
    },
    [updateSetting],
  );

  // ── Dictionary ─────────────────────────────────────────────────────────────
  const [dictEntries, setDictEntries] = useState<DictionaryEntry[]>([]);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [dictError, setDictError] = useState<string | null>(null);
  const [dictStatus, setDictStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const loadDict = useCallback(async () => {
    try {
      const result = await commands.getDictionary();
      if (result.status === "ok") setDictEntries(result.data);
    } catch {
      setDictEntries([]);
    }
  }, []);

  useEffect(() => {
    loadDict();
  }, [loadDict]);

  const handleAddTerm = async () => {
    const from = newFrom.trim();
    const to = newTo.trim();
    setDictError(null);
    setDictStatus(null);
    if (!from || !to) {
      setDictError("Les deux champs sont requis.");
      return;
    }
    try {
      const result = await commands.addDictionaryEntry(from, to);
      if (result.status === "ok") {
        setNewFrom("");
        setNewTo("");
        await loadDict();
      } else {
        setDictError(
          typeof result.error === "string"
            ? result.error
            : "Erreur lors de l'ajout.",
        );
      }
    } catch (e) {
      setDictError(typeof e === "string" ? e : "Erreur lors de l'ajout.");
    }
  };

  const handleRemoveTerm = async (from: string) => {
    try {
      await commands.removeDictionaryEntry(from);
      await loadDict();
    } catch {
      /* noop */
    }
  };

  const handleExportTerms = useCallback(async () => {
    try {
      const filePath = await save({
        defaultPath: `vocalype-termes-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "Texte", extensions: ["txt"] },
        ],
      });
      if (!filePath) return;

      const ext = filePath.split(".").pop()?.toLowerCase() ?? "json";
      const sortedEntries = [...dictEntries].sort((a, b) =>
        a.from.localeCompare(b.from, "fr"),
      );
      const content =
        ext === "txt"
          ? sortedEntries
              .map((entry) => `${entry.from} -> ${entry.to}`)
              .join("\n")
          : JSON.stringify(sortedEntries, null, 2);

      await writeTextFile(filePath, content);
      setDictStatus({
        tone: "success",
        message:
          ext === "txt"
            ? "Termes exportés en .txt."
            : "Termes exportés en .json.",
      });
    } catch {
      setDictStatus({
        tone: "error",
        message: "Échec de l'export des termes.",
      });
    }
  }, [dictEntries]);

  // ── History ────────────────────────────────────────────────────────────────
  const [recentEntries, setRecentEntries] = useState<HistoryEntry[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const [entriesRes, statsRes] = await Promise.all([
        commands.getHistoryEntriesPaginated(5, 0),
        commands.getHistoryStats(),
      ]);
      if (entriesRes.status === "ok") setRecentEntries(entriesRes.data[0]);
      if (statsRes.status === "ok") setHistoryStats(statsRes.data);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    loadHistory();
    let unlisten: (() => void) | null = null;
    listen("history-updated", loadHistory).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [loadHistory]);

  // Derived stats
  const statsWordsTotal = historyStats?.total_words ?? 0;
  const statsEntries = historyStats?.total_entries ?? 0;
  const statsToday = historyStats?.entries_today ?? 0;
  // Estimate time saved: avg 40 wpm typing vs 150 wpm speech → 110 wpm gain
  const savedMin = Math.round((statsWordsTotal / 110) * 10) / 10;
  const savedH = Math.floor(savedMin / 60);
  const savedM = Math.round(savedMin % 60);
  const savedStr =
    savedH > 0
      ? `${savedH} h ${savedM.toString().padStart(2, "0")}`
      : `${savedM} min`;

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"reglages" | "termes">("reglages");

  const goToHistory = useCallback(() => {
    void emit("navigate-to-section", "history");
  }, []);

  // ── Tester le micro — Web Audio API ───────────────────────────────────────
  const [isTesting, setIsTesting] = useState(false);
  const [levelLabel, setLevelLabel] = useState<{ text: string; color: string }>(
    {
      text: "Bon",
      color: "var(--good)",
    },
  );

  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const gaugeFillRef = useRef<HTMLDivElement | null>(null);
  const frameCountRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  const stopTesting = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    analyserRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
    rafRef.current = null;
    frameCountRef.current = 0;
    setIsTesting(false);
    setLevelLabel({ text: "Bon", color: "var(--good)" });
  }, []);

  const handleTestMic = useCallback(async () => {
    if (isTesting) {
      stopTesting();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      streamRef.current = stream;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const animate = () => {
        analyser.getByteFrequencyData(dataArray);

        // Update gauge fill
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++)
          sumSq += (dataArray[i] / 255) ** 2;
        const rms = Math.sqrt(sumSq / dataArray.length);
        if (gaugeFillRef.current) {
          gaugeFillRef.current.style.width = `${Math.min(100, rms * 260)}%`;
        }

        // Update level label every 20 frames
        frameCountRef.current++;
        if (frameCountRef.current % 20 === 0) {
          if (rms < 0.08)
            setLevelLabel({ text: "Faible", color: "var(--rec)" });
          else if (rms < 0.55)
            setLevelLabel({ text: "Bon", color: "var(--good)" });
          else setLevelLabel({ text: "Fort", color: "var(--accent)" });
        }

        rafRef.current = requestAnimationFrame(animate);
      };

      rafRef.current = requestAnimationFrame(animate);
      setIsTesting(true);
    } catch {
      /* permission refusée ou pas de micro */
    }
  }, [isTesting, stopTesting]);

  // ── Mic dropdown ──────────────────────────────────────────────────────────
  const [showMicDropdown, setShowMicDropdown] = useState(false);
  const micDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMicDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        micDropdownRef.current &&
        !micDropdownRef.current.contains(e.target as Node)
      ) {
        setShowMicDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMicDropdown]);

  const handleSelectMic = useCallback(
    async (device: (typeof audioDevices)[number]) => {
      setShowMicDropdown(false);
      await updateSetting("selected_microphone", device.name);
      await updateSetting("selected_microphone_index", device.index);
    },
    [updateSetting, audioDevices],
  );

  // "Insertion auto au curseur" → paste_method !== "none"
  const pasteMethod =
    (getSetting("paste_method") as string | undefined) ?? "ctrl_v";
  const insertionEnabled = pasteMethod !== "none";
  const selectedLanguage =
    (getSetting("selected_language") as string | undefined) ?? "auto";
  const postProcessPrompts = getSetting("post_process_prompts") ?? [];
  const selectedPromptId =
    (getSetting("post_process_selected_prompt_id") as
      | string
      | null
      | undefined) ?? null;
  const selectedLanguageLabel =
    LANGUAGES.find((language) => language.value === selectedLanguage)?.label ??
    selectedLanguage;
  const selectedPromptLabel =
    postProcessPrompts.find((prompt) => prompt.id === selectedPromptId)?.name ??
    postProcessPrompts[0]?.name ??
    "Aucun ton";

  const handleToggleInsertion = useCallback(async () => {
    const next = insertionEnabled ? "none" : "ctrl_v";
    await commands.changePasteMethodSetting(next);
    await updateSetting("paste_method", next as AppSettings["paste_method"]);
  }, [insertionEnabled, updateSetting]);

  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showToneDropdown, setShowToneDropdown] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const toneDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showLanguageDropdown && !showToneDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showLanguageDropdown &&
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(target)
      ) {
        setShowLanguageDropdown(false);
      }
      if (
        showToneDropdown &&
        toneDropdownRef.current &&
        !toneDropdownRef.current.contains(target)
      ) {
        setShowToneDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLanguageDropdown, showToneDropdown]);

  const handleSelectLanguage = useCallback(
    async (languageCode: string) => {
      setShowLanguageDropdown(false);
      await updateSetting("selected_language", languageCode);
    },
    [updateSetting],
  );

  const handleSelectTone = useCallback(
    async (promptId: string) => {
      setShowToneDropdown(false);
      await updateSetting("post_process_selected_prompt_id", promptId);
    },
    [updateSetting],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── All CSS from the mockup ── */}

      <div className="dv">
        <section className="main">
          {/* sticky header */}
          <div className="main-head">
            <div className="head-actions">
              <button
                className="btn btn-rec"
                onClick={handleTestMic}
                style={
                  isTesting
                    ? { background: "var(--rec)", borderColor: "transparent" }
                    : {}
                }
              >
                <span
                  className="dot"
                  style={
                    isTesting
                      ? {
                          background: "#fff",
                          animation: "dvPulse 1s ease-out infinite",
                        }
                      : {}
                  }
                />
                {isTesting ? "Arrêter" : "Tester le micro"}
              </button>
            </div>
          </div>

          {/* HERO */}
          <div className="hero">
            <div className="hero-grid">
              <div className="hero-left">
                <span className="hero-status">
                  <span className="pulse" /> Prêt à dicter
                </span>
                <h2 className="hero-h">
                  Profil <span className="accent">Travail</span>
                </h2>
                {/* Real shortcut display */}
                <div className="kbd-row">
                  <span className="kbd-label">Raccourci</span>
                  {shortcutParts.length > 0 ? (
                    shortcutParts.map((part, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="kbd-plus">+</span>}
                        <span className="kbd gold">{part}</span>
                      </React.Fragment>
                    ))
                  ) : (
                    <>
                      <span className="kbd gold">Ctrl</span>
                      <span className="kbd-plus">+</span>
                      <span className="kbd gold">Space</span>
                    </>
                  )}
                  <span className="kbd-label" style={{ marginLeft: 6 }}>
                    ·
                  </span>
                  <span className="kbd-label">{modeName}</span>
                </div>
              </div>
              <div className="hero-right">
                <div className="mic-card">
                  <div className={`mic-orb${isTesting ? " active" : ""}`}>
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="3" width="6" height="12" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0" />
                      <line x1="12" y1="18" x2="12" y2="22" />
                    </svg>
                  </div>
                  <div className="mic-info">
                    <div className="lab">Entrée</div>
                    {/* Real mic name */}
                    <div className="name">{micName}</div>
                    <WaveForm
                      analyser={isTesting ? analyserRef.current : null}
                    />
                    <div className="meter">
                      <span>Niveau</span>
                      <div className="gauge" style={{ position: "relative" }}>
                        {isTesting && (
                          <div
                            ref={gaugeFillRef}
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "0%",
                              background:
                                "linear-gradient(90deg,var(--good),var(--accent))",
                              borderRadius: "inherit",
                            }}
                          />
                        )}
                      </div>
                      <span style={{ color: levelLabel.color }}>
                        {levelLabel.text}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TABS */}
          <div className="tabs">
            <button
              className={`tab${activeTab === "reglages" ? " active" : ""}`}
              onClick={() => setActiveTab("reglages")}
            >
              Réglages
            </button>
            <button
              className={`tab${activeTab === "termes" ? " active" : ""}`}
              onClick={() => setActiveTab("termes")}
            >
              Noms &amp; termes{" "}
              <span className="badge">{dictEntries.length}</span>
            </button>
          </div>

          {/* ── TAB: RÉGLAGES ── */}
          {activeTab === "reglages" && (
            <div className="panel">
              {/* Raccourci */}
              <div className="section-h">
                <div className="section-title">Raccourci</div>
              </div>
              <div className="card gold">
                <div className="cico">
                  <svg className="ic" viewBox="0 0 24 24">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
                  </svg>
                </div>
                <div>
                  <div className="ctitle">Raccourci de dictée</div>
                  <div className="csub">
                    Appuie pour parler et insérer le texte au curseur.
                  </div>
                </div>
                {/* Shortcut capture button */}
                <div ref={captureRef} style={{ position: "relative" }}>
                  {isCapturing ? (
                    <div
                      style={{
                        minWidth: 120,
                        height: 32,
                        padding: "0 12px",
                        borderRadius: 8,
                        border: "1px solid var(--accent-line)",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        fontSize: 12,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        userSelect: "none",
                      }}
                    >
                      {captureRecorded.length > 0 ? (
                        captureRecorded.map((k, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span style={{ opacity: 0.5 }}>+</span>}
                            <span style={{ textTransform: "capitalize" }}>
                              {k}
                            </span>
                          </React.Fragment>
                        ))
                      ) : (
                        <span
                          style={{
                            opacity: 0.6,
                            fontStyle: "italic",
                            fontFamily: "inherit",
                          }}
                        >
                          Appuie…
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      className="select-btn"
                      onClick={() => void startCapture()}
                      title="Cliquer pour modifier le raccourci"
                    >
                      {shortcutParts.length > 0 ? (
                        shortcutParts.map((part, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && (
                              <span style={{ color: "var(--text4)" }}>+</span>
                            )}
                            <span
                              className="kbd"
                              style={{ padding: "2px 6px", fontSize: 11 }}
                            >
                              {part}
                            </span>
                          </React.Fragment>
                        ))
                      ) : (
                        <>
                          <span
                            className="kbd"
                            style={{ padding: "2px 6px", fontSize: 11 }}
                          >
                            Ctrl
                          </span>
                          <span style={{ color: "var(--text4)" }}>+</span>
                          <span
                            className="kbd"
                            style={{ padding: "2px 6px", fontSize: 11 }}
                          >
                            Space
                          </span>
                        </>
                      )}
                      <svg className="ic ic-sm car" viewBox="0 0 24 24">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="card">
                <div className="cico">
                  <svg className="ic" viewBox="0 0 24 24">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <div>
                  <div className="ctitle">Insertion auto au curseur</div>
                  <div className="csub">
                    Le texte transcrit est collé là où tu écris. Désactive pour
                    copier dans le presse-papier.
                  </div>
                </div>
                <div
                  className={`switch${insertionEnabled ? " on" : ""}`}
                  onClick={() => void handleToggleInsertion()}
                />
              </div>

              {/* Microphone — real device name */}
              <div className="section-h">
                <div className="section-title">Microphone</div>
                <button
                  className="section-action"
                  onClick={handleTestMic}
                  style={isTesting ? { color: "var(--rec)" } : {}}
                >
                  {isTesting ? "Arrêter →" : "Tester →"}
                </button>
              </div>
              <div className="card">
                <div className="cico">
                  <svg className="ic" viewBox="0 0 24 24">
                    <rect x="9" y="3" width="6" height="12" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                  </svg>
                </div>
                <div>
                  <div className="ctitle">Entrée audio</div>
                  <div className="csub">
                    {micName} — détecté automatiquement.
                  </div>
                </div>
                <div ref={micDropdownRef} style={{ position: "relative" }}>
                  <button
                    className="select-btn"
                    onClick={() => setShowMicDropdown((v) => !v)}
                  >
                    {micName.length > 20 ? micName.slice(0, 20) + "…" : micName}{" "}
                    <svg className="ic ic-sm car" viewBox="0 0 24 24">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {showMicDropdown && audioDevices.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 6px)",
                        minWidth: 220,
                        background: "linear-gradient(180deg,#1b1b1e,#131316)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 10,
                        boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
                        zIndex: 50,
                        padding: "4px",
                      }}
                    >
                      {audioDevices.map((device) => {
                        const isSelected = device.name === micName;
                        return (
                          <button
                            key={device.index}
                            onClick={() => void handleSelectMic(device)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                              padding: "8px 10px",
                              borderRadius: 7,
                              border: "none",
                              background: isSelected
                                ? "rgba(212,168,88,0.12)"
                                : "transparent",
                              color: isSelected
                                ? "var(--accent)"
                                : "rgba(255,255,255,0.76)",
                              fontSize: 12.5,
                              fontFamily: "inherit",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected)
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.background = "rgba(255,255,255,0.06)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected)
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.background = "transparent";
                            }}
                          >
                            {isSelected && (
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {device.name}
                              {device.is_default ? " (défaut)" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Mode d'enregistrement — real settings */}
              <div className="section-h">
                <div className="section-title">Mode d'enregistrement</div>
              </div>
              <div className="radio-grid">
                {(
                  [
                    {
                      id: "bascule" as const,
                      label: "Bascule",
                      desc: "Une pression pour démarrer, une autre pour arrêter.",
                      icon: (
                        <svg className="ic ic-sm" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M9 9h6v6H9z" />
                        </svg>
                      ),
                    },
                    {
                      id: "ptt" as const,
                      label: "Appuyer pour parler",
                      desc: "Maintiens le raccourci, relâche pour arrêter.",
                      icon: (
                        <svg className="ic ic-sm" viewBox="0 0 24 24">
                          <path d="M9 4h6v8a3 3 0 0 1-6 0z" />
                          <path d="M5 12a7 7 0 0 0 14 0" />
                        </svg>
                      ),
                    },
                    {
                      id: "vad" as const,
                      label: "Toujours actif",
                      desc: "VAD — détecte la parole et démarre tout seul.",
                      icon: (
                        <svg className="ic ic-sm" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="3" />
                          <circle cx="12" cy="12" r="7" opacity={0.5} />
                        </svg>
                      ),
                    },
                  ] as const
                ).map(({ id, label, desc, icon }) => (
                  <div
                    key={id}
                    className={`radio${currentMode === id ? " active" : ""}`}
                    onClick={() => handleModeSelect(id)}
                  >
                    <span className="check" />
                    <div className="ric">{icon}</div>
                    <div className="rn">{label}</div>
                    <div className="rs">{desc}</div>
                  </div>
                ))}
              </div>

              {/* Langue & ton */}
              <div className="section-h">
                <div className="section-title">Langue &amp; ton</div>
              </div>
              <div className="card">
                <div className="cico">
                  <svg className="ic" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                  </svg>
                </div>
                <div>
                  <div className="ctitle">Langue parlée</div>
                  <div className="csub">
                    Vocalype peut détecter automatiquement, ou rester sur une
                    langue.
                  </div>
                </div>
                <div ref={languageDropdownRef} style={{ position: "relative" }}>
                  <button
                    className="select-btn"
                    onClick={() => {
                      setShowToneDropdown(false);
                      setShowLanguageDropdown((v) => !v);
                    }}
                  >
                    {selectedLanguageLabel}
                    <svg className="ic ic-sm car" viewBox="0 0 24 24">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {showLanguageDropdown && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 6px)",
                        minWidth: 220,
                        maxHeight: 280,
                        overflowY: "auto",
                        background: "linear-gradient(180deg,#1b1b1e,#131316)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 10,
                        boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
                        zIndex: 50,
                        padding: "4px",
                      }}
                    >
                      {LANGUAGES.map((language) => {
                        const isSelected = language.value === selectedLanguage;
                        return (
                          <button
                            key={language.value}
                            className="menu-option"
                            onClick={() =>
                              void handleSelectLanguage(language.value)
                            }
                            style={{
                              display: "flex",
                              alignItems: "center",
                              width: "100%",
                              padding: "8px 10px",
                              borderRadius: 7,
                              border: "none",
                              background: isSelected
                                ? "rgba(212,168,88,0.14)"
                                : "transparent",
                              color: isSelected
                                ? "var(--accent)"
                                : "var(--text)",
                              fontSize: 12.5,
                              textAlign: "left",
                            }}
                          >
                            {language.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="card">
                <div className="cico">
                  <svg className="ic" viewBox="0 0 24 24">
                    <path d="M4 6h16M4 12h10M4 18h16" />
                  </svg>
                </div>
                <div>
                  <div className="ctitle">Ton par défaut</div>
                  <div className="csub">
                    Vocalype reformule légèrement pour rester pro mais naturel.
                  </div>
                </div>
                <div ref={toneDropdownRef} style={{ position: "relative" }}>
                  <button
                    className="select-btn"
                    onClick={() => {
                      setShowLanguageDropdown(false);
                      setShowToneDropdown((v) => !v);
                    }}
                  >
                    {selectedPromptLabel}
                    <svg className="ic ic-sm car" viewBox="0 0 24 24">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {showToneDropdown && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 6px)",
                        minWidth: 220,
                        background: "linear-gradient(180deg,#1b1b1e,#131316)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 10,
                        boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
                        zIndex: 50,
                        padding: "4px",
                      }}
                    >
                      {postProcessPrompts.length > 0 ? (
                        postProcessPrompts.map((prompt) => {
                          const isSelected = prompt.id === selectedPromptId;
                          return (
                            <button
                              key={prompt.id}
                              className="menu-option"
                              onClick={() => void handleSelectTone(prompt.id)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                width: "100%",
                                padding: "8px 10px",
                                borderRadius: 7,
                                border: "none",
                                background: isSelected
                                  ? "rgba(212,168,88,0.14)"
                                  : "transparent",
                                color: isSelected
                                  ? "var(--accent)"
                                  : "var(--text)",
                                fontSize: 12.5,
                                textAlign: "left",
                              }}
                            >
                              {prompt.name}
                            </button>
                          );
                        })
                      ) : (
                        <div
                          style={{
                            padding: "8px 10px",
                            color: "var(--text3)",
                            fontSize: 12.5,
                          }}
                        >
                          Aucun ton configure.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Termes appris — real dictionary data */}
              <div className="section-h">
                <div className="section-title">
                  Termes appris{" "}
                  <span
                    style={{
                      color: "var(--text3)",
                      fontWeight: 500,
                      fontSize: 13,
                    }}
                  >
                    · {dictEntries.length}
                  </span>
                </div>
                <button
                  className="section-action"
                  onClick={() => setActiveTab("termes")}
                >
                  Tout gérer →
                </button>
              </div>
              <div
                className="card"
                style={{
                  gridTemplateColumns: "1fr",
                  gap: 0,
                  padding: "14px 16px",
                }}
              >
                <div className="terms-row">
                  <input
                    className="input"
                    placeholder="Vocalype entend…"
                    value={newFrom}
                    onChange={(e) => {
                      setNewFrom(e.target.value);
                      setDictError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTerm()}
                    style={
                      dictError
                        ? { borderColor: "rgba(239,90,90,0.5)" }
                        : undefined
                    }
                  />
                  <span className="arr">→</span>
                  <input
                    className="input"
                    placeholder="Remplacer par…"
                    value={newTo}
                    onChange={(e) => {
                      setNewTo(e.target.value);
                      setDictError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTerm()}
                    style={
                      dictError
                        ? { borderColor: "rgba(239,90,90,0.5)" }
                        : undefined
                    }
                  />
                  <button className="btn-add" onClick={handleAddTerm}>
                    Ajouter
                  </button>
                </div>
                {dictError && (
                  <div
                    style={{
                      color: "#ef5a5a",
                      fontSize: 12,
                      marginTop: 6,
                      paddingLeft: 2,
                    }}
                  >
                    {dictError}
                  </div>
                )}
                {dictStatus && (
                  <div
                    style={{
                      color:
                        dictStatus.tone === "success"
                          ? "var(--good)"
                          : "#ef5a5a",
                      fontSize: 12,
                      marginTop: 6,
                      paddingLeft: 2,
                    }}
                  >
                    {dictStatus.message}
                  </div>
                )}
                {dictEntries.length === 0 ? (
                  <div className="terms-empty">
                    Aucun terme appris — ajoute des noms propres, acronymes ou
                    corrections.
                  </div>
                ) : (
                  <div className="terms-list">
                    {dictEntries.slice(0, 6).map((entry) => (
                      <div key={entry.from} className="term">
                        <span className="heard">"{entry.from}"</span>
                        <span className="arr">→</span>
                        <span className="into">{entry.to}</span>
                        <button
                          className="tdel"
                          onClick={() => handleRemoveTerm(entry.from)}
                        >
                          <svg className="ic ic-sm" viewBox="0 0 24 24">
                            <line x1="6" y1="6" x2="18" y2="18" />
                            <line x1="18" y1="6" x2="6" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activité récente — real history entries */}
              <div className="section-h">
                <div className="section-title">Dernières dictées</div>
                <button className="section-action" onClick={goToHistory}>
                  Voir l'historique →
                </button>
              </div>
              {recentEntries.length === 0 ? (
                <div className="rec-empty">Aucune dictée pour l'instant.</div>
              ) : (
                <div className="rec-list">
                  {recentEntries.slice(0, 3).map((entry) => {
                    const text =
                      entry.post_processed_text ?? entry.transcription_text;
                    const firstLetter = text.trim().charAt(0).toUpperCase();
                    return (
                      <div key={entry.id} className="rec-item">
                        <div className="rec-ico">{firstLetter}</div>
                        <div>
                          <div className="rec-text">{text}</div>
                        </div>
                        <div className="rec-time">
                          {fmtRelTime(entry.timestamp)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ?????? TAB: NOMS & TERMES ??? real dictionary ?????? */}
          {activeTab === "termes" && (
            <div className="panel">
              <div className="section-h" style={{ marginTop: 4 }}>
                <div className="section-title">
                  Termes appris{" "}
                  <span
                    style={{
                      color: "var(--text3)",
                      fontWeight: 500,
                      fontSize: 13,
                    }}
                  >
                    · {dictEntries.length}
                  </span>
                </div>
                {dictEntries.length > 0 && (
                  <button
                    className="section-action"
                    onClick={handleExportTerms}
                  >
                    Tout exporter →
                  </button>
                )}
              </div>
              <div
                className="card"
                style={{
                  gridTemplateColumns: "1fr",
                  gap: 0,
                  padding: "14px 16px",
                }}
              >
                <div className="terms-row">
                  <input
                    className="input"
                    placeholder="Vocalype entend…"
                    value={newFrom}
                    onChange={(e) => {
                      setNewFrom(e.target.value);
                      setDictError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTerm()}
                    style={
                      dictError
                        ? { borderColor: "rgba(239,90,90,0.5)" }
                        : undefined
                    }
                  />
                  <span className="arr">→</span>
                  <input
                    className="input"
                    placeholder="Remplacer par…"
                    value={newTo}
                    onChange={(e) => {
                      setNewTo(e.target.value);
                      setDictError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTerm()}
                    style={
                      dictError
                        ? { borderColor: "rgba(239,90,90,0.5)" }
                        : undefined
                    }
                  />
                  <button className="btn-add" onClick={handleAddTerm}>
                    Ajouter
                  </button>
                </div>
                {dictError && (
                  <div
                    style={{
                      color: "#ef5a5a",
                      fontSize: 12,
                      marginTop: 6,
                      paddingLeft: 2,
                    }}
                  >
                    {dictError}
                  </div>
                )}
                {dictStatus && (
                  <div
                    style={{
                      color:
                        dictStatus.tone === "success"
                          ? "var(--good)"
                          : "#ef5a5a",
                      fontSize: 12,
                      marginTop: 6,
                      paddingLeft: 2,
                    }}
                  >
                    {dictStatus.message}
                  </div>
                )}
                {dictEntries.length === 0 ? (
                  <div className="terms-empty">
                    Aucun terme appris pour l'instant.
                  </div>
                ) : (
                  <div className="terms-list">
                    {dictEntries.map((entry) => (
                      <div key={entry.from} className="term">
                        <span className="heard">"{entry.from}"</span>
                        <span className="arr">→</span>
                        <span className="into">{entry.to}</span>
                        <button
                          className="tdel"
                          onClick={() => handleRemoveTerm(entry.from)}
                        >
                          <svg className="ic ic-sm" viewBox="0 0 24 24">
                            <line x1="6" y1="6" x2="18" y2="18" />
                            <line x1="18" y1="6" x2="6" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
};
