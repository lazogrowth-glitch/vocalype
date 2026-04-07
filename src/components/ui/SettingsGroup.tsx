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
    <section className="settings-group">
      {title && (
        <div className="settings-group-header">
          <div className="flex items-center gap-2.5">
            <h2 className="settings-group-title">{title}</h2>
            {titleBadge}
          </div>
          {description && (
            <p className="settings-group-description">{description}</p>
          )}
        </div>
      )}
      <div className="settings-group-card">{children}</div>
    </section>
  );
};
