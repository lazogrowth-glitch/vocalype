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
    "rounded-[7px] border border-white/10 bg-white/[0.06] text-start text-[12.5px] font-normal text-white/70 transition-all duration-150";

  const interactiveClasses = disabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-white/[0.08] hover:border-white/14 focus:outline-none focus:bg-white/[0.08] focus:border-white/14";

  const variantStyle = {
    default: { padding: "10px 16px" },
    compact: { padding: "10px 16px", minHeight: "38px" },
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
