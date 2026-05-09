/* eslint-disable i18next/no-literal-string */
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { listen, emit } from "@tauri-apps/api/event";
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

  // "Suppression du bruit" et "Mode privé" — local only (no backend setting yet)
  const [bruitOn, setBruitOn] = useState(true);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── All CSS from the mockup ── */}
      <style>{`
        /* root tokens */
        .dv { --bg0:#0a0a0c;--bg1:#111114;--bg2:#16161a;--bg3:#1c1c22;--bg4:#24242c;--line:rgba(255,255,255,0.06);--line2:rgba(255,255,255,0.10);--text:#ededee;--text2:#b6b6bd;--text3:#82828b;--text4:#56565e;--accent:#d4a858;--accent2:#e6bd6c;--accent-soft:rgba(212,168,88,0.14);--accent-line:rgba(212,168,88,0.32);--rec:#ef5a5a;--good:#6cce8c;--radius-lg:14px;--radius-md:10px;--radius-sm:8px; }
        .dv * { box-sizing:border-box; }
        .dv button { font-family:inherit;color:inherit;background:none;border:0;cursor:pointer; }
        .dv ::-webkit-scrollbar { width:10px;height:10px; }
        .dv ::-webkit-scrollbar-track { background:transparent; }
        .dv ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.06);border-radius:8px; }
        .dv ::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.12); }

        /* layout */
        .dv { display:grid;grid-template-columns:1fr;height:100%;overflow:hidden;font-size:14px;font-family:inherit;color:var(--text); }

        /* mid pane */
        .dv .mid { border-right:1px solid var(--line);background:var(--bg1);display:flex;flex-direction:column;overflow:hidden; }
        .dv .mid-head { padding:18px 18px 14px; }
        .dv .mid-title-row { display:flex;align-items:baseline;gap:8px; }
        .dv .mid-title { font-size:22px;font-weight:700;letter-spacing:-0.01em; }
        .dv .mid-count { font-size:13px;color:var(--text3);font-weight:500; }
        .dv .mid-sub { color:var(--text3);font-size:13px;margin-top:6px;line-height:1.5;max-width:320px; }
        .dv .search-row { display:flex;gap:6px;margin-top:14px; }
        .dv .search { flex:1;display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2);color:var(--text3);font-size:12.5px; }
        .dv .search input { flex:1;background:none;border:0;outline:0;color:var(--text);font:inherit; }
        .dv .search input::placeholder { color:var(--text3); }
        .dv .icon-btn-gold { width:34px;height:34px;background:var(--accent);color:#1a1306;border-radius:8px;display:grid;place-items:center;transition:background .15s; }
        .dv .icon-btn-gold:hover { background:var(--accent2); }
        .dv .filter-row { display:flex;gap:6px;padding:0 18px 12px; }
        .dv .chip { height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--bg2);color:var(--text2);font-size:12.5px;display:inline-flex;align-items:center;gap:6px;transition:background .14s; }
        .dv .chip:hover { background:var(--bg3);color:var(--text); }
        .dv .chip.active { color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line); }
        .dv .chip .num { color:var(--text3);font-size:11.5px; }
        .dv .chip.active .num { color:var(--accent);opacity:.8; }
        .dv .profiles { flex:1;overflow-y:auto;padding:4px 12px 18px; }
        .dv .group-label { font-size:10.5px;letter-spacing:0.14em;font-weight:600;color:var(--text4);padding:14px 6px 8px; }
        .dv .profile { border:1px solid transparent;border-radius:10px;padding:12px;display:grid;grid-template-columns:36px 1fr auto;gap:10px;align-items:start;margin:2px 0;cursor:pointer;position:relative; }
        .dv .profile:hover { background:var(--bg2); }
        .dv .profile.active { background:var(--bg2);border-color:var(--line2); }
        .dv .profile.active::before { content:"";position:absolute;left:0;top:14px;bottom:14px;width:2px;background:var(--accent);border-radius:2px;margin-left:-1px; }
        .dv .pico { width:36px;height:36px;border-radius:9px;background:var(--bg3);border:1px solid var(--line);color:var(--text2);display:grid;place-items:center; }
        .dv .profile.active .pico { background:linear-gradient(135deg,rgba(212,168,88,.2),rgba(212,168,88,.08));border-color:var(--accent-line);color:var(--accent); }
        .dv .pname { font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px; }
        .dv .pmeta { font-size:12px;color:var(--text3);margin-top:4px;line-height:1.4; }
        .dv .pfoot { margin-top:8px;display:flex;align-items:center;gap:8px;color:var(--text4);font-size:11.5px; }
        .dv .ptag { font-size:10px;letter-spacing:.1em;font-weight:600;color:var(--text3);background:var(--bg3);border:1px solid var(--line);padding:2px 6px;border-radius:4px;text-transform:uppercase; }
        .dv .pkbd { font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;color:var(--text2);background:var(--bg3);border:1px solid var(--line);padding:2px 6px;border-radius:4px; }
        .dv .ptools { display:flex;gap:2px;opacity:0;transition:opacity .15s; }
        .dv .profile:hover .ptools,.dv .profile.active .ptools { opacity:1; }
        .dv .pdot { width:22px;height:22px;border-radius:6px;color:var(--text3);display:grid;place-items:center; }
        .dv .pdot:hover { background:var(--bg3);color:var(--text); }

        /* main pane */
        .dv .main { background:var(--bg1);overflow-y:auto;overflow-x:hidden; }
        .dv .main-head { display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg1);z-index:5;gap:16px; }
        .dv .crumb { display:flex;align-items:center;gap:8px;color:var(--text3);font-size:12.5px; }
        .dv .crumb-tag { display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg2);color:var(--text2);font-size:12.5px; }
        .dv .head-actions { display:flex;gap:6px;align-items:center; }
        .dv .btn { height:32px;padding:0 14px;border-radius:8px;background:var(--bg2);border:1px solid var(--line);color:var(--text);font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:8px;transition:background .15s,border-color .15s; }
        .dv .btn:hover { background:var(--bg3);border-color:var(--line2); }
        .dv .btn-icon { width:32px;padding:0;justify-content:center; }
        .dv .btn-rec { background:var(--accent);color:#1a1306;border-color:transparent;font-weight:600; }
        .dv .btn-rec:hover { background:var(--accent2); }
        .dv .btn-rec .dot { width:7px;height:7px;border-radius:50%;background:#1a1306; }

        /* hero */
        .dv .hero { margin:22px 22px 0;border:1px solid var(--line);border-radius:14px;background:radial-gradient(800px 280px at 90% -50%,rgba(212,168,88,.08),transparent 60%),linear-gradient(180deg,rgba(212,168,88,.025),transparent 60%),var(--bg2);overflow:hidden;position:relative; }
        .dv .hero-grid { display:grid;grid-template-columns:1fr 1fr; }
        .dv .hero-left { padding:22px 24px;border-right:1px solid var(--line); }
        .dv .hero-right { padding:22px 24px; }
        .dv .hero-status { display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:11.5px;letter-spacing:.12em;font-weight:600;text-transform:uppercase; }
        .dv .pulse { width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent);animation:dvPulse 1.8s ease-out infinite; }
        @keyframes dvPulse { 0%{box-shadow:0 0 0 0 rgba(212,168,88,.6)} 100%{box-shadow:0 0 0 14px rgba(212,168,88,0)} }
        .dv .hero-h { font-size:26px;font-weight:700;letter-spacing:-.015em;margin:12px 0 6px; }
        .dv .hero-h .accent { color:var(--accent); }
        .dv .hero-sub { color:var(--text3);font-size:13.5px;line-height:1.55;max-width:380px; }
        .dv .kbd-row { margin-top:18px;display:flex;align-items:center;gap:10px; }
        .dv .kbd-label { color:var(--text3);font-size:12.5px; }
        .dv .kbd { font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:500;color:var(--text);background:var(--bg3);border:1px solid var(--line2);border-bottom-width:2px;padding:4px 9px;border-radius:6px; }
        .dv .kbd.gold { color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft); }
        .dv .kbd-plus { color:var(--text4);font-size:12px; }
        .dv .mic-card { display:flex;align-items:center;gap:18px;height:100%; }
        .dv .mic-orb { width:96px;height:96px;border-radius:50%;background:radial-gradient(circle at 50% 40%,rgba(212,168,88,.25),transparent 60%),radial-gradient(circle at 50% 60%,rgba(212,168,88,.12),transparent 70%),var(--bg3);border:1px solid var(--accent-line);display:grid;place-items:center;color:var(--accent);flex:0 0 96px;position:relative; }
        .dv .mic-orb::before,.dv .mic-orb::after { display:none; }
        .dv .mic-orb.active::before { content:"";display:block;position:absolute;inset:-8px;border-radius:50%;border:1px solid rgba(212,168,88,.2);animation:dvRing 2.4s ease-out infinite; }
        @keyframes dvRing { 0%{transform:scale(.7);opacity:.9;border-color:rgba(212,168,88,.4)} 100%{transform:scale(1.25);opacity:0} }
        .dv .mic-info { flex:1;min-width:0; }
        .dv .mic-info .lab { font-size:11.5px;letter-spacing:.12em;font-weight:600;color:var(--text3);text-transform:uppercase; }
        .dv .mic-info .name { font-size:15px;font-weight:600;margin-top:4px; }
        .dv .bar { flex:1;height:22%;background:linear-gradient(180deg,var(--accent2),var(--accent));border-radius:2px;transform-origin:center;opacity:0.45; }
        @keyframes dvWave { 0%,100%{height:18%} 50%{height:90%} }
        .dv .meter { margin-top:10px;display:flex;align-items:center;gap:10px;color:var(--text3);font-size:11.5px; }
        .dv .gauge { flex:1;height:4px;border-radius:2px;background:var(--bg3);overflow:hidden;position:relative; }
        @keyframes dvMeter { 0%{width:28%} 100%{width:78%} }

        /* stats */
        .dv .stat-row { display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 22px 0; }
        .dv .stat { border:1px solid var(--line);border-radius:12px;background:var(--bg2);padding:14px 16px; }
        .dv .stat .lab { color:var(--text3);font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;font-weight:600; }
        .dv .stat .val { font-size:22px;font-weight:700;margin-top:4px;letter-spacing:-.01em; }
        .dv .stat .delta { color:var(--good);font-size:11.5px;margin-top:2px; }
        .dv .stat .delta.muted { color:var(--text3); }

        /* tabs */
        .dv .tabs { margin:22px 22px 0;display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--line); }
        .dv .tab { height:38px;padding:0 14px;color:var(--text3);font-size:13.5px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;align-items:center;gap:8px;transition:color .14s; }
        .dv .tab:hover { color:var(--text2); }
        .dv .tab.active { color:var(--accent);border-color:var(--accent); }
        .dv .tab .badge { font-size:11px;padding:1px 6px;background:var(--bg3);border:1px solid var(--line);border-radius:4px;color:var(--text3); }
        .dv .tab.active .badge { background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent); }

        /* panel */
        .dv .panel { padding:22px 22px 32px; }
        .dv .section-h { display:flex;align-items:baseline;justify-content:space-between;margin:22px 4px 12px; }
        .dv .section-h:first-child { margin-top:4px; }
        .dv .section-title { font-size:14px;font-weight:600;color:var(--text);letter-spacing:-.005em; }
        .dv .section-action { color:var(--text3);font-size:12.5px; }
        .dv .section-action:hover { color:var(--text); }

        /* cards */
        .dv .card { border:1px solid var(--line);border-radius:12px;background:var(--bg2);padding:16px 18px;margin-bottom:8px;display:grid;grid-template-columns:36px 1fr auto;gap:14px;align-items:center; }
        .dv .cico { width:36px;height:36px;border-radius:9px;background:var(--bg3);border:1px solid var(--line);display:grid;place-items:center;color:var(--text2); }
        .dv .card.gold .cico { background:linear-gradient(135deg,rgba(212,168,88,.18),rgba(212,168,88,.06));border-color:var(--accent-line);color:var(--accent); }
        .dv .ctitle { font-size:14px;font-weight:600; }
        .dv .csub { color:var(--text3);font-size:12.5px;margin-top:3px;line-height:1.45; }
        .dv .select-btn { height:32px;padding:0 12px;border-radius:8px;background:var(--bg3);border:1px solid var(--line);color:var(--text);font-size:12.5px;display:inline-flex;align-items:center;gap:8px; }
        .dv .select-btn:hover { background:var(--bg4); }
        .dv .select-btn .car { color:var(--text3); }
        .dv .menu-option { transition:background .14s,color .14s; }
        .dv .menu-option:hover { background:var(--bg3) !important;color:var(--accent) !important; }
        .dv .switch { width:38px;height:22px;background:var(--bg4);border-radius:999px;position:relative;border:1px solid var(--line);cursor:pointer;flex-shrink:0; }
        .dv .switch::after { content:"";position:absolute;left:2px;top:1px;width:18px;height:18px;border-radius:50%;background:#d8d8de;transition:transform .18s,background .18s; }
        .dv .switch.on { background:var(--accent);border-color:var(--accent); }
        .dv .switch.on::after { transform:translateX(15px);background:#1a1306; }

        /* radio cards */
        .dv .radio-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:4px; }
        .dv .radio { border:1px solid var(--line);background:var(--bg2);border-radius:12px;padding:14px;cursor:pointer;position:relative;display:flex;flex-direction:column;gap:8px;min-height:116px;transition:background .14s; }
        .dv .radio:hover { background:var(--bg3); }
        .dv .radio.active { border-color:var(--accent-line);background:linear-gradient(180deg,rgba(212,168,88,.06),transparent 70%),var(--bg2); }
        .dv .ric { width:28px;height:28px;border-radius:8px;background:var(--bg3);border:1px solid var(--line);color:var(--text2);display:grid;place-items:center; }
        .dv .radio.active .ric { background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent); }
        .dv .rn { font-size:13.5px;font-weight:600; }
        .dv .rs { color:var(--text3);font-size:11.5px;line-height:1.45; }
        .dv .check { position:absolute;top:12px;right:12px;width:16px;height:16px;border:1.5px solid var(--text4);border-radius:50%; }
        .dv .radio.active .check { border-color:var(--accent);background:radial-gradient(circle,var(--accent) 4px,transparent 4.5px); }

        /* terms */
        .dv .terms-row { display:grid;grid-template-columns:1fr 24px 1fr auto;gap:10px;align-items:center;margin-top:12px; }
        .dv .input { height:38px;padding:0 12px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit;font-size:13px;outline:0; }
        .dv .input:focus { border-color:var(--accent-line);background:var(--bg3); }
        .dv .input::placeholder { color:var(--text4); }
        .dv .terms-row .arr { text-align:center;color:var(--text4); }
        .dv .btn-add { height:38px;padding:0 16px;background:transparent;border:1px solid var(--accent-line);color:var(--accent);border-radius:8px;font-weight:500;font-size:13px; }
        .dv .btn-add:hover { background:var(--accent-soft); }
        .dv .terms-list { margin-top:14px;border:1px dashed var(--line2);border-radius:12px;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px; }
        .dv .terms-empty { margin-top:14px;padding:24px;text-align:center;color:var(--text4);font-size:13px;font-style:italic;border:1px dashed var(--line2);border-radius:12px; }
        .dv .term { display:grid;grid-template-columns:1fr 18px 1fr auto;align-items:center;gap:10px;padding:8px 12px;border-radius:8px; }
        .dv .term:hover { background:var(--bg2); }
        .dv .term .heard { color:var(--text3);font-size:12.5px;font-style:italic; }
        .dv .term .arr { color:var(--text4);text-align:center; }
        .dv .term .into { color:var(--text);font-weight:500;font-size:13px; }
        .dv .term .tdel { width:24px;height:24px;border-radius:6px;color:var(--text4);display:grid;place-items:center;opacity:0; }
        .dv .term:hover .tdel { opacity:1; }
        .dv .term .tdel:hover { color:var(--text);background:var(--bg3); }

        /* activity */
        .dv .rec-list { display:flex;flex-direction:column;gap:4px;margin-top:4px; }
        .dv .rec-item { display:grid;grid-template-columns:32px 1fr auto;gap:12px;padding:10px 12px;border-radius:10px;align-items:center; }
        .dv .rec-item:hover { background:var(--bg2); }
        .dv .rec-time { color:var(--text4);font-size:11.5px;font-variant-numeric:tabular-nums; }
        .dv .rec-text { font-size:13px;color:var(--text2);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical; }
        .dv .rec-words { color:var(--text4);font-size:11.5px;margin-top:2px; }
        .dv .rec-ico { width:32px;height:32px;border-radius:8px;background:var(--bg3);border:1px solid var(--line);display:grid;place-items:center;color:var(--text3);font-size:11px;font-weight:600; }
        .dv .rec-empty { padding:32px;text-align:center;color:var(--text4);font-size:13px;font-style:italic; }

        /* disclosure */
        .dv .disclosure { margin:18px 4px 0;color:var(--text2);font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none; }
        .dv .disclosure:hover { color:var(--text); }
        .dv .disclosure .car { color:var(--text3);transition:transform .15s; }
        .dv .disclosure.open .car { transform:rotate(90deg); }

        /* generic icons */
        .dv .ic { width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round; }
        .dv .ic-sm { width:14px;height:14px; }
        .dv .ic-lg { width:20px;height:20px; }

        /* responsive */
        @media (max-width:1100px) {
          .dv .stat-row { grid-template-columns:repeat(2,1fr); }
          .dv .hero-grid { grid-template-columns:1fr; }
          .dv .hero-left { border-right:0;border-bottom:1px solid var(--line); }
          .dv .radio-grid { grid-template-columns:1fr; }
          .dv .terms-list { grid-template-columns:1fr; }
        }
      `}</style>

      <div className="dv">
        <section className="main">
          {/* sticky header */}
          <div className="main-head">
            <div>
              <div className="mid-title-row">
                <h1 className="mid-title">Dictée</h1>
              </div>
              <p className="mid-sub" style={{ marginTop: 2 }}>
                Parle dans n'importe quelle app — Vocalype transforme ta voix en
                texte propre, à ta façon.
              </p>
            </div>
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
                <p className="hero-sub">
                  Appuie sur le raccourci dans n'importe quelle app — Vocalype
                  écoute, transcrit, nettoie et insère le texte au curseur.
                </p>
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

          {/* STATS — real data from historyStats */}
          <div className="stat-row">
            <div className="stat">
              <div className="lab">Mots dictés</div>
              <div className="val">
                {statsWordsTotal > 0 ? fmtNum(statsWordsTotal) : "—"}
              </div>
              <div className="delta muted">
                {statsToday > 0 ? `+${statsToday} aujourd'hui` : "total"}
              </div>
            </div>
            <div className="stat">
              <div className="lab">Temps économisé</div>
              <div className="val">{statsWordsTotal > 0 ? savedStr : "—"}</div>
              <div className="delta">
                {statsWordsTotal > 0 ? "≈ 3.75× plus rapide" : ""}
              </div>
            </div>
            <div className="stat">
              <div className="lab">Sessions</div>
              <div className="val">
                {statsEntries > 0 ? fmtNum(statsEntries) : "—"}
              </div>
              <div className="delta muted">
                {historyStats?.entries_this_week
                  ? `${historyStats.entries_this_week} cette semaine`
                  : "total"}
              </div>
            </div>
            <div className="stat">
              <div className="lab">Termes appris</div>
              <div className="val">{dictEntries.length}</div>
              <div className="delta muted">dans le dictionnaire</div>
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
                <button
                  className="section-action"
                  onClick={() => void emit("navigate-to-section", "advanced")}
                >
                  Voir tous les raccourcis →
                </button>
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
              <div className="card">
                <div className="cico">
                  <svg className="ic" viewBox="0 0 24 24">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15 9a4 4 0 0 1 0 6" />
                  </svg>
                </div>
                <div>
                  <div className="ctitle">Suppression du bruit</div>
                  <div className="csub">
                    Réduit clavier, ventilateur et bruits de fond. Léger surcoût
                    CPU.
                  </div>
                </div>
                <div
                  className={`switch${bruitOn ? " on" : ""}`}
                  onClick={() => setBruitOn((v) => !v)}
                />
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
                    const words = wordCount(text);
                    const firstLetter = text.trim().charAt(0).toUpperCase();
                    return (
                      <div key={entry.id} className="rec-item">
                        <div className="rec-ico">{firstLetter}</div>
                        <div>
                          <div className="rec-text">{text}</div>
                          <div className="rec-words">
                            {words} mot{words > 1 ? "s" : ""}
                          </div>
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
                <button className="section-action">Tout exporter →</button>
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
