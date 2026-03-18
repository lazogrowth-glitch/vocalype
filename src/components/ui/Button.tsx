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
    "cursor-pointer rounded-[8px] border font-medium focus:outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50";

  const variantClasses = {
    primary:
      "border-logo-primary/25 bg-logo-primary/12 text-logo-primary hover:bg-logo-primary/18 focus:ring-1 focus:ring-logo-primary/30",
    "primary-soft":
      "border-logo-primary/25 bg-logo-primary/12 text-logo-primary hover:bg-logo-primary/18 focus:ring-1 focus:ring-logo-primary/30",
    secondary:
      "border-white/10 bg-white/[0.05] text-white/70 hover:bg-white/[0.08] hover:border-white/14 focus:outline-none",
    danger:
      "text-white bg-red-600 border-mid-gray/20 hover:bg-red-700 hover:border-red-700 focus:ring-1 focus:ring-red-500",
    "danger-ghost":
      "text-red-400 border-transparent hover:text-red-300 hover:bg-red-500/10 focus:bg-red-500/20",
    ghost:
      "text-current border-transparent hover:bg-white/[0.05] focus:bg-white/[0.08]",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-[12px]",
    md: "px-4 py-2 text-[13px]",
    lg: "px-4 py-2.5 text-[14px]",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
