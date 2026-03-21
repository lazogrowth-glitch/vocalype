import React from "react";

interface InfoTooltipProps {
  content: string;
  className?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ content, className = "" }) => (
  <span
    title={content}
    aria-label={content}
    className={`inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-white/20 text-[8px] font-semibold text-white/35 hover:border-white/40 hover:text-white/60 transition-colors ml-1 ${className}`}
  >
    ?
  </span>
);
