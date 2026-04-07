import React from "react";

interface SettingsGroupProps {
  title?: string;
  /** Optional badge/node rendered inline after the title (e.g. a "Premium" pill) */
  titleBadge?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  titleBadge,
  description,
  children,
}) => {
  return (
    <section style={{ marginBottom: 32 }}>
      {title && (
        <div style={{ marginBottom: 8 }}>
          <div className="flex items-center gap-2">
            <h2
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "rgba(255,255,255,0.50)",
                letterSpacing: "0.01em",
              }}
            >
              {title}
            </h2>
            {titleBadge}
          </div>
          {description && (
            <p
              style={{
                marginTop: 2,
                fontSize: 12,
                color: "rgba(255,255,255,0.35)",
                lineHeight: "1.5",
              }}
            >
              {description}
            </p>
          )}
        </div>
      )}
      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        {children}
      </div>
    </section>
  );
};
