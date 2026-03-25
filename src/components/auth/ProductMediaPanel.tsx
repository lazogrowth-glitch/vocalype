/* eslint-disable i18next/no-literal-string */
import { Globe2, Mic2, Settings2, Sparkles, Wand2 } from "lucide-react";
import type { AuthStepContent } from "./authOnboardingContent";
import "./ProductMediaPanel.css";

interface ProductMediaPanelProps {
  step: AuthStepContent;
}

const renderStepCard = (step: AuthStepContent) => {
  switch (step.id) {
    case "permissions":
      return (
        <div className="vt-media-card vt-media-card-permissions">
          <div className="vt-media-toolbar">
            <div className="vt-media-bullet" />
            <div className="vt-media-bullet" />
            <div className="vt-media-bullet" />
          </div>
          <div className="vt-media-stack">
            {[
              { icon: <Mic2 size={15} />, label: "Microphone", state: "Ready" },
              {
                icon: <Settings2 size={15} />,
                label: "Accessibility",
                state: "Enabled",
              },
              {
                icon: <Sparkles size={15} />,
                label: "Global shortcut",
                state: "Bound",
              },
            ].map((item) => (
              <div key={item.label} className="vt-permission-row">
                <div className="vt-permission-icon">{item.icon}</div>
                <div className="vt-permission-copy">
                  <div>{item.label}</div>
                  <span>{item.state}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "set-up":
      return (
        <div className="vt-media-card vt-media-card-setup">
          <div className="vt-chip-cloud">
            <span>Windows</span>
            <span>ChatGPT</span>
            <span>Claude</span>
            <span>Gemini</span>
          </div>
          <div className="vt-setup-shell">
            <div className="vt-setup-head">Vocalype is ready</div>
            <div className="vt-setup-line" />
            <div className="vt-setup-grid">
              <div>Shortcut active</div>
              <div>Voice capture armed</div>
              <div>Paste injection synced</div>
              <div>Premium access checked</div>
            </div>
          </div>
        </div>
      );
    case "learn":
      return (
        <div className="vt-media-card vt-media-card-learn">
          <div className="vt-message-window">
            <div className="vt-message-header">
              <div className="vt-message-app">
                <Globe2 size={16} />
                <span>Workspace</span>
              </div>
              <span>Voice draft</span>
            </div>
            <div className="vt-message-body">
              <div className="vt-message-line vt-long" />
              <div className="vt-message-line vt-mid" />
              <div className="vt-message-line vt-short" />
            </div>
            <div className="vt-message-output">
              "Peux-tu envoyer la version finale au client avant 16h ?"
            </div>
          </div>
        </div>
      );
    case "personalize":
      return (
        <div className="vt-media-card vt-media-card-personalize">
          <div className="vt-chip-cloud">
            <span>French</span>
            <span>English</span>
            <span>Formal</span>
            <span>Fast edits</span>
          </div>
          <div className="vt-profile-shell">
            <div className="vt-profile-row">
              <span>Preferred language</span>
              <strong>French</strong>
            </div>
            <div className="vt-profile-row">
              <span>Output style</span>
              <strong>Clean</strong>
            </div>
            <div className="vt-profile-row">
              <span>Correction level</span>
              <strong>Balanced</strong>
            </div>
          </div>
        </div>
      );
    default:
      return (
        <div className="vt-media-card vt-media-card-signup">
          <div className="vt-chip-cloud">
            <span>ChatGPT</span>
            <span>Claude</span>
            <span>Gemini</span>
            <span>Windows</span>
          </div>
          <div className="vt-hero-shell">
            <div className="vt-hero-title">
              Write everywhere with your voice
            </div>
            <div className="vt-hero-note">
              Fast capture. Clean output. Premium dictation.
            </div>
            <div className="vt-transcript-card">
              <Wand2 size={18} />
              <span>
                "Rappelle-moi de livrer la maquette finale demain matin."
              </span>
            </div>
          </div>
        </div>
      );
  }
};

export const ProductMediaPanel = ({ step }: ProductMediaPanelProps) => {
  return (
    <section
      style={{
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        borderRadius: 34,
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "radial-gradient(circle at top right, rgba(201,168,76,0.12), transparent 28%), #090909",
      }}
    >
      <div className="vt-media-panel">
        <div className="vt-media-backdrop" />
        <div className="vt-media-shell">
          <div className="vt-media-meta">
            <div>
              <div className="vt-media-step">{step.media.kicker}</div>
              <h2 className="vt-media-title">{step.media.title}</h2>
              <div className="vt-media-subtitle">{step.media.subtitle}</div>
            </div>
            <div className="vt-media-badges">
              {step.media.badges.map((badge, index) => (
                <div
                  key={`${step.id}-${badge}`}
                  className="vt-media-badge"
                  style={{ animationDelay: `${index * 0.55}s` }}
                >
                  {badge}
                </div>
              ))}
            </div>
          </div>

          {renderStepCard(step)}
        </div>
      </div>
    </section>
  );
};
