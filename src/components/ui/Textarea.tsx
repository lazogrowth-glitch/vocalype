import React from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  ...props
}) => {
  const baseClasses =
    "text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded-md text-start transition-[background-color,border-color] duration-150 hover:bg-logo-primary/10 hover:border-logo-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background focus:bg-logo-primary/10 focus:border-logo-primary resize-y";

  const variantStyle = {
    default: { padding: "10px 16px", minHeight: "100px" },
    compact: { padding: "10px 16px", minHeight: "80px" },
  };

  return (
    <textarea
      className={`${baseClasses} ${className}`}
      style={variantStyle[variant]}
      {...props}
    />
  );
};
