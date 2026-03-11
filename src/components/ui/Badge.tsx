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
    primary: "bg-logo-primary/15 text-logo-primary border border-logo-primary/30",
    success: "bg-green-500/15 text-green-300 border border-green-500/30",
    secondary: "bg-mid-gray/15 text-text/70 border border-mid-gray/25",
    quality: "bg-amber-400/15 text-amber-200 border border-amber-400/35",
    speed: "bg-sky-400/15 text-sky-200 border border-sky-400/35",
    experimental:
      "bg-rose-400/15 text-rose-200 border border-rose-400/35",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
