import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center gap-2 cursor-pointer rounded-[8px] border font-medium leading-none tracking-[0] focus:outline-none transition-all duration-150 hover:-translate-y-[1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

  const variantClasses = {
    primary:
      "border-logo-primary/20 bg-logo-primary/10 text-logo-primary hover:bg-logo-primary/15 hover:border-logo-primary/28 focus:ring-1 focus:ring-logo-primary/30",
    "primary-soft":
      "border-logo-primary/18 bg-logo-primary/8 text-logo-primary hover:bg-logo-primary/12 hover:border-logo-primary/24 focus:ring-1 focus:ring-logo-primary/30",
    secondary:
      "border-white/8 bg-white/[0.035] text-white/72 hover:bg-white/[0.055] hover:border-white/12 hover:text-white/88 focus:outline-none",
    danger:
      "text-white bg-red-600 border-mid-gray/20 hover:bg-red-700 hover:border-red-700 focus:ring-1 focus:ring-red-500",
    "danger-ghost":
      "text-red-400 border-transparent hover:text-red-300 hover:bg-red-500/10 hover:border-red-500/20 focus:bg-red-500/20",
    ghost:
      "text-current border-transparent hover:bg-white/[0.05] hover:text-white focus:bg-white/[0.08]",
  };

  const sizeClasses = {
    sm: "text-[12px] tracking-[0]",
    md: "text-[13px] tracking-[0]",
    lg: "text-[14px] tracking-[0]",
  };

  const sizeStyles = {
    sm: { padding: "10px 14px", minHeight: 38 },
    md: { padding: "12px 16px", minHeight: 42 },
    lg: { padding: "13px 18px", minHeight: 46 },
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      style={sizeStyles[size]}
      {...props}
    >
      {children}
    </button>
  );
};
