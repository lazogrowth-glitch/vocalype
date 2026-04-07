import React from "react";
import i18n from "i18next";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      "[ErrorBoundary] Uncaught React error:",
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100px",
            padding: "24px",
            textAlign: "center",
            color: "#f5f2ed",
            background: "#0f0f0f",
            fontSize: "13px",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "18px" }}>⚠</span>
          <span>
            {i18n.t("error.boundary.sectionMessage")}
          </span>
          {this.state.error && (
            <span style={{ color: "#888", fontSize: "11px" }}>
              {this.state.error.message}
            </span>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "8px",
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid #444",
              borderRadius: "4px",
              color: "#ccc",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {i18n.t("error.boundary.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
