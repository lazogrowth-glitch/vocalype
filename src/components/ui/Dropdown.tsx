import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const getInitialHighlightIndex = useCallback(() => {
    const selectedIndex = options.findIndex(
      (option) => option.value === selectedValue && !option.disabled,
    );
    if (selectedIndex >= 0) {
      return selectedIndex;
    }

    return options.findIndex((option) => !option.disabled);
  }, [options, selectedValue]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    if (onRefresh) onRefresh();
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
        minWidth: rect.width,
      });
    }
    setIsOpen(true);
    setHighlightedIndex(getInitialHighlightIndex());
  }, [disabled, getInitialHighlightIndex, onRefresh]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeDropdown]);

  useEffect(() => {
    if (!isOpen) return;

    setHighlightedIndex((prev) => {
      if (prev >= 0 && options[prev] && !options[prev].disabled) {
        return prev;
      }
      return getInitialHighlightIndex();
    });
  }, [getInitialHighlightIndex, isOpen, options]);

  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );

  const handleSelect = (value: string) => {
    onSelect(value);
    closeDropdown();
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      closeDropdown();
      return;
    }
    openDropdown();
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (options.length === 0) return;

    setHighlightedIndex((prev) => {
      let currentIndex = prev;

      if (
        currentIndex < 0 ||
        currentIndex >= options.length ||
        options[currentIndex]?.disabled
      ) {
        currentIndex = getInitialHighlightIndex();
        if (currentIndex < 0) return -1;
      }

      for (let i = 1; i <= options.length; i++) {
        const next =
          (currentIndex + direction * i + options.length) % options.length;
        if (!options[next]?.disabled) {
          return next;
        }
      }

      return currentIndex;
    });
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      moveHighlight(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      moveHighlight(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      if (!isOpen) {
        event.preventDefault();
        openDropdown();
        return;
      }

      const highlightedOption = options[highlightedIndex];
      if (highlightedOption && !highlightedOption.disabled) {
        event.preventDefault();
        handleSelect(highlightedOption.value);
      }
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeDropdown();
      triggerRef.current?.focus();
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        style={{ height: 32, padding: "0 12px" }}
        className={`flex w-full items-center justify-between rounded-[8px] border text-start text-[12.5px] font-normal text-white/90 transition-all duration-150 ${
          disabled
            ? "cursor-not-allowed border-white/10 bg-[#1c1c22] opacity-50"
            : "cursor-pointer border-white/10 bg-[#1c1c22] hover:border-white/15 hover:bg-[#24242c]"
        }`}
        onClick={handleToggle}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
      >
        <span className="truncate">{selectedOption?.label || placeholder}</span>
        <svg
          className={`ms-2 h-[10px] w-[10px] shrink-0 text-white/50 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen &&
        !disabled &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            className="z-[9999] max-h-60 overflow-y-auto rounded-[10px] border border-white/10 shadow-lg"
            style={{
              ...menuStyle,
              width: "max-content",
              maxWidth: 320,
              background: "linear-gradient(180deg,#1b1b1e,#131316)",
              boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
              padding: 4,
            }}
          >
            {options.length === 0 ? (
              <div
                style={{ padding: "11px 16px" }}
                className="text-[13px] text-mid-gray"
              >
                {t("common.noOptionsFound")}
              </div>
            ) : (
              options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 7,
                    border: "none",
                    background:
                      selectedValue === option.value
                        ? "rgba(212,168,88,0.14)"
                        : highlightedIndex === index
                          ? "#1c1c22"
                          : "transparent",
                    color:
                      selectedValue === option.value ||
                      highlightedIndex === index
                        ? "#d4a858"
                        : "rgba(255,255,255,0.94)",
                    fontSize: 12.5,
                    textAlign: "left",
                    transition: "background .14s,color .14s",
                  }}
                  className={`${option.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  disabled={option.disabled}
                  role="option"
                  aria-selected={selectedValue === option.value}
                >
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};
