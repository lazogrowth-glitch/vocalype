import React from "react";
import ResetIcon from "../icons/ResetIcon";

interface ResetButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}

export const ResetButton: React.FC<ResetButtonProps> = React.memo(
  ({ onClick, disabled = false, className = "", ariaLabel, children }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`flex h-9 w-9 items-center justify-center rounded-[8px] border border-white/8 bg-white/[0.04] transition-all duration-150 ${
        disabled
          ? "cursor-not-allowed opacity-50 text-text/40"
          : "text-white/40 hover:bg-white/[0.08] hover:text-white/70"
      } ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children ?? <ResetIcon />}
    </button>
  ),
);
