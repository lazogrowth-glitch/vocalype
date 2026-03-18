import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";

interface PathDisplayProps {
  path: string;
  onOpen: () => void;
  disabled?: boolean;
}

export const PathDisplay: React.FC<PathDisplayProps> = ({
  path,
  onOpen,
  disabled = false,
}) => {
  const { t } = useTranslation();

  const truncateMiddle = (value: string) => {
    if (value.length <= 58) {
      return value;
    }

    return `${value.slice(0, 24)}...${value.slice(-20)}`;
  };

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className="min-w-0 flex-1 overflow-hidden rounded-[7px] border border-white/10 bg-white/[0.06] px-3 py-[5px] text-[11px] font-mono text-white/55"
        title={path}
      >
        <div className="truncate select-text cursor-text">
          {truncateMiddle(path)}
        </div>
      </div>
      <Button
        onClick={onOpen}
        variant="secondary"
        size="sm"
        disabled={disabled}
        className="shrink-0 whitespace-nowrap"
      >
        {t("common.open")}
      </Button>
    </div>
  );
};
