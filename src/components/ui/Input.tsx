import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  ...props
}) => {
  const baseClasses =
    "rounded-[8px] border border-white/10 bg-zinc-900 text-start text-[13px] font-normal text-white/76 transition-all duration-150";

  const interactiveClasses = disabled
    ? "cursor-not-allowed opacity-60"
    : "hover:border-white/15 hover:bg-zinc-800 focus:outline-none focus:border-logo-primary/40 focus:bg-zinc-800";

  const variantStyle = {
    default: { padding: "12px 16px", minHeight: "44px" },
    compact: { padding: "11px 16px", minHeight: "42px" },
  } as const;

  return (
    <input
      className={`${baseClasses} ${interactiveClasses} ${className}`}
      style={variantStyle[variant]}
      disabled={disabled}
      {...props}
    />
  );
};
