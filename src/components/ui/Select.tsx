import React from "react";
import SelectComponent from "react-select";
import CreatableSelect from "react-select/creatable";
import type {
  ActionMeta,
  Props as ReactSelectProps,
  SingleValue,
  StylesConfig,
} from "react-select";

export type SelectOption = {
  value: string;
  label: string;
  isDisabled?: boolean;
};

type BaseProps = {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  onChange: (value: string | null, action: ActionMeta<SelectOption>) => void;
  onBlur?: () => void;
  className?: string;
  formatCreateLabel?: (input: string) => string;
};

type CreatableProps = {
  isCreatable: true;
  onCreateOption: (value: string) => void;
};

type NonCreatableProps = {
  isCreatable?: false;
  onCreateOption?: never;
};

export type SelectProps = BaseProps & (CreatableProps | NonCreatableProps);

const selectStyles: StylesConfig<SelectOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 44,
    borderRadius: 8,
    borderColor: state.isFocused
      ? "rgba(201,168,76,0.42)"
      : "rgba(255,255,255,0.08)",
    boxShadow: state.isFocused ? "0 0 0 1px rgba(201,168,76,0.22)" : "none",
    backgroundColor: state.isFocused ? "#2A2A30" : "#1F1F23",
    fontSize: "0.875rem",
    color: "var(--color-text)",
    transition: "all 150ms ease",
    ":hover": {
      borderColor: "rgba(255,255,255,0.12)",
      backgroundColor: "#2A2A30",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    paddingInline: 12,
    paddingBlock: 7,
  }),
  input: (base) => ({
    ...base,
    color: "var(--color-text)",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--color-text)",
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused
      ? "var(--color-logo-primary)"
      : "color-mix(in srgb, var(--color-mid-gray) 80%, transparent)",
    ":hover": {
      color: "var(--color-logo-primary)",
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "color-mix(in srgb, var(--color-mid-gray) 80%, transparent)",
    ":hover": {
      color: "var(--color-logo-primary)",
    },
  }),
  menu: (provided) => ({
    ...provided,
    zIndex: 30,
    backgroundColor: "#1F1F23",
    color: "var(--color-text)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    boxShadow: "0 18px 40px rgba(0, 0, 0, 0.32)",
    overflow: "hidden",
  }),
  menuList: (base) => ({
    ...base,
    padding: 6,
    backgroundColor: "#1F1F23",
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "rgba(201,168,76,0.13)"
      : state.isFocused
        ? "#2A2A30"
        : "transparent",
    color: "var(--color-text)",
    borderRadius: 6,
    padding: "11px 12px",
    cursor: state.isDisabled ? "not-allowed" : base.cursor,
    opacity: state.isDisabled ? 0.5 : 1,
    ":active": {
      backgroundColor: "rgba(201,168,76,0.18)",
    },
  }),
  placeholder: (base) => ({
    ...base,
    color: "color-mix(in srgb, var(--color-mid-gray) 65%, transparent)",
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 40,
  }),
};

export const Select: React.FC<SelectProps> = React.memo(
  ({
    value,
    options,
    placeholder,
    disabled,
    isLoading,
    isClearable = true,
    onChange,
    onBlur,
    className = "",
    isCreatable,
    formatCreateLabel,
    onCreateOption,
  }) => {
    const selectValue = React.useMemo(() => {
      if (!value) return null;
      const existing = options.find((option) => option.value === value);
      if (existing) return existing;
      return { value, label: value, isDisabled: false };
    }, [value, options]);

    const handleChange = (
      option: SingleValue<SelectOption>,
      action: ActionMeta<SelectOption>,
    ) => {
      onChange(option?.value ?? null, action);
    };

    const sharedProps: Partial<ReactSelectProps<SelectOption, false>> = {
      className,
      classNamePrefix: "app-select",
      value: selectValue,
      options,
      onChange: handleChange,
      placeholder,
      isDisabled: disabled,
      isLoading,
      onBlur,
      isClearable,
      styles: selectStyles,
      menuPortalTarget: document.body,
    };

    if (isCreatable) {
      return (
        <CreatableSelect<SelectOption, false>
          {...sharedProps}
          onCreateOption={onCreateOption}
          formatCreateLabel={formatCreateLabel}
        />
      );
    }

    return <SelectComponent<SelectOption, false> {...sharedProps} />;
  },
);

Select.displayName = "Select";
