/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* ── Backgrounds ── */
        background: "var(--color-background)",
        panel: "var(--color-panel)",
        /* ── Surfaces ── */
        card: "var(--color-card)",
        "card-hover": "var(--color-card-hover)",
        row: "var(--color-row)",
        "row-hover": "var(--color-row-hover)",
        surface: "var(--color-surface)",
        "surface-elevated": "var(--color-surface-elevated)",
        "surface-strong": "var(--color-surface-strong)",
        /* ── Text ── */
        text: "var(--color-text)",
        "text-sub": "var(--color-text-sub)",
        "text-faint": "var(--color-text-faint)",
        "text-ghost": "var(--color-text-ghost)",
        muted: "var(--color-muted)",
        /* ── Borders ── */
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        "border-row": "var(--color-border-row)",
        /* ── Accent ── */
        accent: "var(--color-accent)",
        "accent-soft": "var(--color-accent-soft)",
        "accent-border": "var(--color-accent-border)",
        "accent-glow": "var(--color-accent-glow)",
        /* ── Status ── */
        success: "var(--color-success)",
        "success-soft": "var(--color-success-soft)",
        danger: "var(--color-danger)",
        "danger-soft": "var(--color-danger-soft)",
        /* ── Brand / logo ── */
        "logo-primary": "var(--color-logo-primary)",
        "logo-stroke": "var(--color-logo-stroke)",
        "text-stroke": "var(--color-text-stroke)",
        "mid-gray": "var(--color-mid-gray)",
      },
      fontWeight: {
        750: "750",
      },
    },
  },
  plugins: [],
};
