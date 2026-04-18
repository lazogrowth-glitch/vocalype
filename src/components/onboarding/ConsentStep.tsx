import React, { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ArrowRight, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConsentStepProps {
  onAccept: (shareDiagnostics?: boolean) => void;
}

const GOLD = "#C9A33A";

const checkboxBoxStyle = (checked: boolean): React.CSSProperties => ({
  width: 18,
  height: 18,
  marginTop: 2,
  borderRadius: 5,
  border: `1px solid ${checked ? GOLD : "rgba(255,255,255,0.18)"}`,
  background: checked ? GOLD : "transparent",
  color: checked ? "#111111" : "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});

const ConsentStep: React.FC<ConsentStepProps> = ({ onAccept }) => {
  const [accepted, setAccepted] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#070707",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: 500,
          maxWidth: "calc(100vw - 48px)",
          borderRadius: 8,
          background: "rgba(14,14,14,0.96)",
          border: "1px solid rgba(255,255,255,0.07)",
          padding: 30,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              margin: "0 auto 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: GOLD,
              background: "rgba(201,163,58,0.12)",
              border: "1px solid rgba(201,163,58,0.18)",
            }}
          >
            <LockKeyhole size={22} />
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              lineHeight: 1.12,
              color: "#F7F7F7",
            }}
          >
            {t("onboarding.consent.title")}
          </h1>

          <p
            style={{
              margin: "12px auto 0",
              maxWidth: 380,
              fontSize: 15,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            {t("onboarding.consent.localStorageInfo")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAccepted((current) => !current)}
          style={{
            width: "100%",
            marginTop: 24,
            borderRadius: 8,
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "14px 16px",
            display: "grid",
            gridTemplateColumns: "20px 1fr",
            columnGap: 12,
            alignItems: "start",
            textAlign: "left",
            cursor: "pointer",
            boxSizing: "border-box",
          }}
        >
          <span style={checkboxBoxStyle(accepted)}>
            <Check size={12} strokeWidth={3} />
          </span>
          <span>
            <span
              style={{
                display: "block",
                fontSize: 15,
                fontWeight: 700,
                color: "#F5F5F5",
              }}
            >
              {t("onboarding.consent.checkboxLabel")}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 4,
                fontSize: 13,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.62)",
              }}
            >
              {t("onboarding.consent.exportInfo")}
            </span>
          </span>
        </button>

        <button
          type="button"
          disabled={!accepted}
          onClick={() => onAccept(false)}
          style={{
            marginTop: 18,
            width: "100%",
            height: 52,
            borderRadius: 8,
            background: GOLD,
            color: "#111111",
            fontSize: 16,
            fontWeight: 800,
            border: "none",
            cursor: accepted ? "pointer" : "not-allowed",
            opacity: accepted ? 1 : 0.4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {t("onboarding.consent.continueButton")}
          <ArrowRight size={16} strokeWidth={2.4} />
        </button>

        <button
          type="button"
          onClick={() => openUrl("https://vocalype.com/privacy")}
          style={{
            width: "100%",
            marginTop: 14,
            background: "transparent",
            border: "none",
            padding: 0,
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(201,163,58,0.92)",
            cursor: "pointer",
          }}
        >
          {t("onboarding.consent.privacyPolicyLink")}
        </button>
      </div>
    </div>
  );
};

export default ConsentStep;
