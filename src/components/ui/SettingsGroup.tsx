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
    <section style={{ marginBottom: 16 }}>
      {title && (
        <div style={{ marginBottom: 14 }}>
          <div className="flex items-center gap-1.5">
            <h2
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "rgba(255,255,255,0.25)",
              }}
            >
              {title}
            </h2>
            {titleBadge}
          </div>
          {description && (
            <p className="mt-1 max-w-2xl text-[11.5px] leading-5 text-text/40">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="rounded-[10px] border border-white/8">{children}</div>
    </section>
  );
};
