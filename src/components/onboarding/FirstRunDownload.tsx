import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModelStore } from "@/stores/modelStore";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import VocalypeLogo from "../icons/VocalypeLogo";

const MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";
interface Props {
  onComplete: () => void;
}

const FirstRunDownload: React.FC<Props> = ({ onComplete }) => {
  const { t } = useTranslation();
  const {
    downloadModel,
    selectModel,
    getDownloadProgress,
    downloadingModels,
    extractingModels,
    models,
    error: modelError,
  } = useModelStore();

  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-start download on mount; skip the wait if a usable model is already installed.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const readyModel =
      models.find((m) => m.id === MODEL_ID && m.is_downloaded) ?? null;

    if (readyModel) {
      selectModel(readyModel.id).then((ok) => {
        if (ok) {
          onComplete();
        } else {
          setError(
            "Modele installe mais impossible de l'activer. Redemarre l'app.",
          );
        }
      });
      return;
    }

    if (MODEL_ID in downloadingModels || MODEL_ID in extractingModels) return;
    downloadModel(MODEL_ID).then((ok) => {
      if (!ok) {
        setError(
          getUserFacingErrorMessage(modelError, {
            t,
            context: "model",
            fallback:
              "Le telechargement a echoue. Verifie ta connexion et reessaie.",
          }),
        );
      }
    });
  }, []);

  // When extraction is done and the model is available, select it and proceed.
  useEffect(() => {
    const readyModel =
      models.find((m) => m.id === MODEL_ID && m.is_downloaded) ?? null;
    if (
      readyModel &&
      !(readyModel.id in downloadingModels) &&
      !(readyModel.id in extractingModels)
    ) {
      selectModel(readyModel.id).then((ok) => {
        if (ok) {
          onComplete();
        } else {
          setError(
            "Modele installe mais impossible de l'activer. Redemarre l'app.",
          );
        }
      });
      return;
    }

    const isDownloading = MODEL_ID in downloadingModels;
    const isExtracting = MODEL_ID in extractingModels;
    if (isDownloading || isExtracting) return;

    const model = models.find((m) => m.id === MODEL_ID);
    if (!model?.is_downloaded) return;

    selectModel(MODEL_ID).then((ok) => {
      if (ok) {
        onComplete();
      } else {
        setError(
          "Modele telecharge mais impossible de l'activer. Redemarre l'app.",
        );
      }
    });
  }, [downloadingModels, extractingModels, models, selectModel, onComplete]);

  const progress = getDownloadProgress(MODEL_ID);
  const isDownloading = MODEL_ID in downloadingModels;
  const isExtracting = MODEL_ID in extractingModels;

  const pct = progress?.percentage ?? 0;
  const downloadedMB = ((progress?.downloaded ?? 0) / 1024 / 1024).toFixed(0);
  const totalMB = ((progress?.total ?? 0) / 1024 / 1024).toFixed(0);

  let statusText = "Connexion...";
  if (isExtracting) statusText = "Preparation du modele...";
  else if (isDownloading && pct > 0)
    statusText = `${downloadedMB} MB / ${totalMB} MB`;
  else if (isDownloading) statusText = "Demarrage du telechargement...";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "linear-gradient(180deg, #111 0%, #090909 100%)",
        gap: 32,
        padding: "0 40px",
      }}
    >
      <VocalypeLogo width={160} />

      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <p
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "rgba(255,255,255,0.9)",
            margin: 0,
          }}
        >
          {t("onboarding.firstRunTitle")}
        </p>
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.4)",
            marginTop: 8,
          }}
        >
          {t("onboarding.firstRunSubtitle")}
        </p>
      </div>

      <div style={{ width: "100%", maxWidth: 400 }}>
        <div
          style={{
            height: 6,
            borderRadius: 99,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 99,
              background: "rgba(100,140,255,0.85)",
              width: `${isExtracting ? 100 : pct}%`,
              transition: "width 0.3s ease",
              opacity: isExtracting ? 0.5 : 1,
              animation: isExtracting
                ? "pulse 1.5s ease-in-out infinite"
                : undefined,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
            fontSize: 12,
            color: "rgba(255,255,255,0.35)",
          }}
        >
          <span>{statusText}</span>
          {isDownloading && !isExtracting && pct > 0 && (
            <span>{Math.round(pct)}%</span>
          )}
        </div>
      </div>

      {error && (
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,100,100,0.85)",
            textAlign: "center",
            maxWidth: 360,
          }}
        >
          {error}
        </p>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

export default FirstRunDownload;
