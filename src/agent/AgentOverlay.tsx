/* eslint-disable i18next/no-literal-string */
import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/bindings";

interface AgentResponsePayload {
  question: string;
  response: string | null;
  error: string | null;
}

const CopyIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const SparkleIcon: React.FC = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

export const AgentOverlay: React.FC = () => {
  const [question, setQuestion] = useState<string>("");
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(async () => {
    await commands.dismissAgentOverlay();
    setQuestion("");
    setResponse(null);
    setError(null);
    setLoading(false);
    setCopied(false);
  }, []);

  const copyResponse = useCallback(async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [response]);

  useEffect(() => {
    const unlistenPromise = listen<AgentResponsePayload>(
      "agent-response",
      (event) => {
        const payload = event.payload;
        setQuestion(payload.question);
        if (payload.error) {
          setError(payload.error);
          setResponse(null);
          setLoading(false);
        } else if (
          payload.response !== null &&
          payload.response !== undefined
        ) {
          setResponse(payload.response);
          setError(null);
          setLoading(false);
        } else {
          // null response + no error = loading state
          setResponse(null);
          setError(null);
          setLoading(true);
        }
        setCopied(false);
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
      }}
    >
      <div
        style={{
          width: "460px",
          maxHeight: "520px",
          background: "rgba(18, 18, 22, 0.92)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: "16px",
          boxShadow:
            "0 24px 64px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <span style={{ color: "rgba(139,92,246,0.9)" }}>
              <SparkleIcon />
            </span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "rgba(255,255,255,0.7)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              AI Assistant
            </span>
          </div>
          <button
            onClick={dismiss}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.35)",
              padding: "4px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "rgba(255,255,255,0.7)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "rgba(255,255,255,0.35)")
            }
          >
            <CloseIcon />
          </button>
        </div>

        {/* Question */}
        {question && (
          <div
            style={{
              padding: "12px 14px 8px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: "rgba(255,255,255,0.38)",
                fontStyle: "italic",
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              "{question}"
            </p>
          </div>
        )}

        {/* Response area */}
        <div
          style={{
            padding: "12px 14px",
            flex: 1,
            overflowY: "auto",
            minHeight: "80px",
          }}
        >
          {loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "rgba(255,255,255,0.4)",
                fontSize: "13px",
              }}
            >
              <LoadingDots />
              <span>Thinking…</span>
            </div>
          )}

          {error && (
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: "rgba(255, 100, 100, 0.85)",
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>
          )}

          {response && (
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: "rgba(255,255,255,0.88)",
                lineHeight: 1.65,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {response}
            </p>
          )}
        </div>

        {/* Footer */}
        {(response || error) && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
              padding: "8px 14px 12px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {response && (
              <button
                onClick={copyResponse}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "5px 11px",
                  background: copied
                    ? "rgba(139,92,246,0.25)"
                    : "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: "7px",
                  color: copied
                    ? "rgba(139,92,246,0.95)"
                    : "rgba(255,255,255,0.6)",
                  fontSize: "12px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!copied)
                    e.currentTarget.style.background = "rgba(255,255,255,0.11)";
                }}
                onMouseLeave={(e) => {
                  if (!copied)
                    e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                }}
              >
                <CopyIcon />
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
            <button
              onClick={dismiss}
              style={{
                padding: "5px 11px",
                background: "none",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: "7px",
                color: "rgba(255,255,255,0.4)",
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.4)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
              }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const LoadingDots: React.FC = () => {
  const dotStyle = (delay: string): React.CSSProperties => ({
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    background: "rgba(139,92,246,0.7)",
    display: "inline-block",
    animation: "agentDotBounce 1.2s ease-in-out infinite",
    animationDelay: delay,
  });

  return (
    <>
      <style>{`
        @keyframes agentDotBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <span style={{ display: "flex", gap: "3px", alignItems: "center" }}>
        <span style={dotStyle("0s")} />
        <span style={dotStyle("0.2s")} />
        <span style={dotStyle("0.4s")} />
      </span>
    </>
  );
};
