import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?:
    | "primary"
    | "success"
    | "secondary"
    | "quality"
    | "speed"
    | "experimental";
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
}) => {
  const variantClasses = {
    primary: "border border-logo-primary/25 bg-logo-primary/15 text-logo-primary",
    success: "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    secondary: "border border-white/10 bg-white/[0.06] text-white/42",
    quality: "border border-white/10 bg-white/[0.06] text-white/42",
    speed: "border border-sky-400/18 bg-sky-400/10 text-sky-200",
    experimental:
      "bg-rose-400/15 text-rose-200 border border-rose-400/35",
  };

  return (
    <span
      className={`inline-flex items-center rounded-[4px] px-[8px] py-[2px] text-[10px] font-medium leading-none ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
