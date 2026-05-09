/* eslint-disable i18next/no-literal-string */
import React, { useState } from "react";
import { Cpu } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { useModelStore } from "@/stores/modelStore";

const C = {
  line: "rgba(255,255,255,0.06)",
  bg3: "rgba(255,255,255,0.04)",
  text: "#ededee",
  text2: "rgba(255,255,255,0.52)",
  text3: "rgba(255,255,255,0.32)",
  gold: "#d4a858",
  danger: "#ef5a5a",
};

const PRIMARY_MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";

export const TranscriptionEngineCard: React.FC = () => {
  const {
    currentModel,
    models,
    downloadModel,
    downloadingModels,
    downloadProgress,
    deleteModel,
  } = useModelStore();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const modelInfo: ModelInfo | undefined = models.find(
    (m) => m.id === currentModel,
  );

  const primaryModel: ModelInfo | undefined = models.find(
    (m) => m.id === PRIMARY_MODEL_ID,
  );

  const isInstalled = !!currentModel;
  const isDownloading = PRIMARY_MODEL_ID in downloadingModels;

  const displayName = modelInfo?.name ?? currentModel ?? null;
  const sizeMb = modelInfo?.size_mb ?? primaryModel?.size_mb ?? null;
  const sizeStr = sizeMb
    ? sizeMb >= 1000
      ? `${(sizeMb / 1024).toFixed(1)} GB`
      : `${sizeMb} MB`
    : null;

  const progressData = downloadProgress[PRIMARY_MODEL_ID];
  const progress = Math.round(progressData?.percentage ?? 0);
  const downloadedMb = progressData
    ? Math.round(progressData.downloaded / 1024 / 1024)
    : 0;
  const totalMb = progressData?.total
    ? Math.round(progressData.total / 1024 / 1024)
    : (sizeMb ?? 0);
  const progressLabel =
    totalMb > 0 ? `${downloadedMb} MB / ${totalMb} MB` : `${progress}%`;

  const desc =
    !isInstalled && !isDownloading
      ? "Aucun modèle installé"
      : isDownloading
        ? `Téléchargement… ${progressLabel}`
        : displayName && sizeStr
          ? `${displayName} · ${sizeStr}`
          : (displayName ?? "—");

  const handleConfirm = async () => {
    setResetting(true);
    setConfirming(false);
    await deleteModel(currentModel);
    setResetting(false);
  };

  const handleDownload = async () => {
    await downloadModel(PRIMARY_MODEL_ID);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "36px 1fr auto",
        gap: 14,
        alignItems: "center",
        padding: "16px 18px",
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      {/* Icon */}
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
        <Cpu size={16} />
      </div>

      {/* Label + progress bar si download en cours */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
          Moteur de transcription
        </div>
        <div style={{ fontSize: 12.5, color: C.text3, marginTop: 3 }}>
          {desc}
        </div>
        {isDownloading && (
          <div
            style={{
              marginTop: 6,
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 2,
                background: C.gold,
                width: `${progress}%`,
                transition: "width .3s ease",
              }}
            />
          </div>
        )}
      </div>

      {/* Action */}
      {!isInstalled && !isDownloading ? (
        <button
          type="button"
          onClick={handleDownload}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(212,168,88,0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(212,168,88,0.12)";
          }}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 7,
            background: "rgba(212,168,88,0.12)",
            border: "1px solid rgba(212,168,88,0.32)",
            color: C.gold,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            transition: "background .12s",
          }}
        >
          Télécharger
        </button>
      ) : isDownloading ? (
        <div style={{ fontSize: 12, color: C.text3, whiteSpace: "nowrap" }}>
          {progress}%
        </div>
      ) : confirming ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 7,
              background: "transparent",
              border: "1px solid rgba(201,168,76,0.4)",
              color: C.gold,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={resetting}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 7,
              background: "rgba(239,90,90,0.12)",
              border: "1px solid rgba(239,90,90,0.35)",
              color: C.danger,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: resetting ? "not-allowed" : "pointer",
              opacity: resetting ? 0.5 : 1,
            }}
          >
            {resetting ? "..." : "Confirmer"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.color = C.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = C.bg3;
            e.currentTarget.style.borderColor = C.line;
            e.currentTarget.style.color = C.text2;
          }}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 7,
            background: C.bg3,
            border: `1px solid ${C.line}`,
            color: C.text2,
            fontSize: 12.5,
            fontWeight: 500,
            cursor: "pointer",
            transition: "background .12s, border-color .12s, color .12s",
          }}
        >
          Désinstaller
        </button>
      )}
    </div>
  );
};
