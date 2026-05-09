import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Globe } from "lucide-react";
import { LANGUAGES } from "@/lib/constants/languages.ts";

interface LanguageFilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

export const LanguageFilterDropdown: React.FC<LanguageFilterDropdownProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const filteredLanguages = useMemo(() => {
    return LANGUAGES.filter(
      (lang) =>
        lang.value !== "auto" &&
        lang.label.toLowerCase().includes(search.toLowerCase()),
    );
  }, [search]);

  const selectedLabel = useMemo(() => {
    if (value === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return LANGUAGES.find((lang) => lang.value === value)?.label || "";
  }, [value, t]);

  const close = (newValue?: string) => {
    if (newValue !== undefined) onChange(newValue);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{ padding: "10px 16px" }}
        className={`flex items-center gap-1.5 rounded-[8px] border text-[12.5px] transition-all duration-150 ${
          value !== "all"
            ? "border-logo-primary/25 bg-[rgba(212,168,88,0.14)] text-logo-primary"
            : "border-white/10 bg-[#1c1c22] text-white/65 hover:border-white/15 hover:bg-[#24242c] hover:text-white/85"
        }`}
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">{selectedLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-[10px] border border-white/10"
          style={{
            background: "linear-gradient(180deg,#1b1b1e,#131316)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
          }}
        >
          <div className="border-b border-white/8 p-2">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredLanguages.length > 0) {
                  close(filteredLanguages[0].value);
                } else if (e.key === "Escape") {
                  close();
                }
              }}
              placeholder={t("settings.general.language.searchPlaceholder")}
              style={{ padding: "10px 16px" }}
              className="w-full rounded-[8px] border border-white/10 bg-[#1c1c22] text-sm text-white/90 outline-none transition-colors focus:border-logo-primary/40 focus:bg-[#24242c]"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => close("all")}
              style={{ padding: "10px 16px" }}
              className={`w-full rounded-[7px] text-left text-sm transition-colors ${
                value === "all"
                  ? "bg-[rgba(212,168,88,0.14)] font-semibold text-logo-primary"
                  : "text-white/90 hover:bg-[#1c1c22] hover:text-logo-primary"
              }`}
            >
              {t("settings.models.filters.allLanguages")}
            </button>
            {filteredLanguages.map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => close(lang.value)}
                style={{ padding: "10px 16px" }}
                className={`w-full rounded-[7px] text-left text-sm transition-colors ${
                  value === lang.value
                    ? "bg-[rgba(212,168,88,0.14)] font-semibold text-logo-primary"
                    : "text-white/90 hover:bg-[#1c1c22] hover:text-logo-primary"
                }`}
              >
                {lang.label}
              </button>
            ))}
            {filteredLanguages.length === 0 && (
              <div
                style={{ padding: "10px 16px" }}
                className="text-center text-sm text-text/50"
              >
                {t("settings.general.language.noResults")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
