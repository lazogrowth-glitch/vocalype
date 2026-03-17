import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <section>
      {title && (
        <div style={{ marginTop: 24, marginBottom: 12 }}>
          <h2 style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.25)" }}>
            {title}
          </h2>
          {description && (
            <p className="mt-[2px] max-w-2xl text-[11.5px] leading-5 text-text/40">
              {description}
            </p>
          )}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
};
