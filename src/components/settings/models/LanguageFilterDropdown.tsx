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
        className={`flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[12.5px] ${
          value !== "all"
            ? "border-logo-primary/25 bg-logo-primary/12 text-logo-primary"
            : "border-white/10 bg-white/[0.06] text-white/55 hover:text-white/75"
        }`}
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">{selectedLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-mid-gray/80 bg-background shadow-lg">
          <div className="border-b border-mid-gray/40 p-2">
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
              className="w-full rounded-md border border-mid-gray/40 bg-mid-gray/10 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-logo-primary"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => close("all")}
              className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                value === "all"
                  ? "bg-logo-primary/20 font-semibold text-logo-primary"
                  : "hover:bg-mid-gray/10"
              }`}
            >
              {t("settings.models.filters.allLanguages")}
            </button>
            {filteredLanguages.map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => close(lang.value)}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                  value === lang.value
                    ? "bg-logo-primary/20 font-semibold text-logo-primary"
                    : "hover:bg-mid-gray/10"
                }`}
              >
                {lang.label}
              </button>
            ))}
            {filteredLanguages.length === 0 && (
              <div className="px-3 py-2 text-center text-sm text-text/50">
                {t("settings.general.language.noResults")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
