import React, { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Database, LockKeyhole, ShieldCheck, Check, ArrowRight } from "lucide-react";

interface ConsentStepProps {
  onAccept: (shareDiagnostics?: boolean) => void;
}

const GOLD = "#C9A33A";

const infoCards = [
  {
    icon: LockKeyhole,
    title: "100% local",
    body: "Rien n'est envoye pour la transcription.",
  },
  {
    icon: ShieldCheck,
    title: "Licence uniquement",
    body: "Seul un identifiant d'appareil hache et la version servent a valider l'acces.",
  },
  {
    icon: Database,
    title: "Toujours sous controle",
    body: "Vous pouvez exporter ou supprimer vos donnees plus tard.",
  },
];

const wordmarkPartStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1,
};

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
  transition: "all 160ms ease",
  flexShrink: 0,
});

const ConsentStep: React.FC<ConsentStepProps> = ({ onAccept }) => {
  const [accepted, setAccepted] = useState(false);
  const [shareDiagnostics, setShareDiagnostics] = useState(false);

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
          width: 560,
          maxWidth: "calc(100vw - 48px)",
          borderRadius: 24,
          background: "rgba(14,14,14,0.96)",
          border: "1px solid rgba(255,255,255,0.07)",
          padding: 32,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "baseline" }}>
            <span style={{ ...wordmarkPartStyle, color: "#F7F7F7" }}>Vocal</span>
            <span style={{ ...wordmarkPartStyle, color: GOLD }}>ype</span>
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              letterSpacing: "0.18em",
              fontWeight: 600,
              color: GOLD,
              textTransform: "uppercase",
            }}
          >
            FIRST LAUNCH
          </div>

          <h1
            style={{
              marginTop: 18,
              marginBottom: 0,
              fontSize: 24,
              fontWeight: 700,
              lineHeight: 1.2,
              color: "#F7F7F7",
            }}
          >
            Parlez. Vocalype ecrit.
          </h1>

          <p
            style={{
              marginTop: 10,
              marginBottom: 0,
              marginLeft: "auto",
              marginRight: "auto",
              maxWidth: 440,
              fontSize: 15,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            Avant de commencer, voici l'essentiel sur la confidentialite et le stockage de vos donnees.
          </p>
        </div>

        <div
          style={{
            marginTop: 28,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {infoCards.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              style={{
                minHeight: 72,
                borderRadius: 16,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "14px 16px",
                display: "grid",
                gridTemplateColumns: "40px 1fr",
                alignItems: "start",
                columnGap: 14,
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: "rgba(201,163,58,0.12)",
                  border: "1px solid rgba(201,163,58,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: GOLD,
                }}
              >
                <Icon size={18} />
              </div>

              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#F5F5F5",
                  }}
                >
                  {title}
                </p>
                <p
                  style={{
                    marginTop: 4,
                    marginBottom: 0,
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: "rgba(255,255,255,0.72)",
                  }}
                >
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 14,
            textAlign: "center",
          }}
        >
          <button
            type="button"
            onClick={() => openUrl("https://vocalype.com/privacy")}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 14,
              fontWeight: 600,
              color: GOLD,
              cursor: "pointer",
            }}
          >
            Lire la politique de confidentialite complete {"->"}
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setAccepted((current) => !current)}
            style={{
              width: "100%",
              borderRadius: 14,
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
                  fontWeight: 600,
                  color: "#F5F5F5",
                }}
              >
                J'accepte la politique de confidentialite
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                Je comprends et j'accepte la facon dont Vocalype gere mes donnees.
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShareDiagnostics((current) => !current)}
            style={{
              width: "100%",
              borderRadius: 14,
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
            <span style={checkboxBoxStyle(shareDiagnostics)}>
              <Check size={12} strokeWidth={3} />
            </span>
            <span>
              <span
                style={{
                  display: "block",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#F5F5F5",
                }}
              >
                Aider a ameliorer Vocalype
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                J'accepte de partager des logs techniques lorsque je signale un bug. C'est optionnel et modifiable plus tard.
              </span>
            </span>
          </button>
        </div>

        <button
          type="button"
          disabled={!accepted}
          onClick={() => onAccept(shareDiagnostics)}
          style={{
            marginTop: 20,
            width: "100%",
            height: 52,
            borderRadius: 14,
            background: GOLD,
            color: "#111111",
            fontSize: 16,
            fontWeight: 700,
            border: "none",
            cursor: accepted ? "pointer" : "not-allowed",
            opacity: accepted ? 1 : 0.4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          Activer Vocalype
          <ArrowRight size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
};

export default ConsentStep;
