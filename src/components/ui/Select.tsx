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
    minHeight: 32,
    borderRadius: 8,
    borderColor: state.isFocused
      ? "rgba(201,168,76,0.42)"
      : "rgba(255,255,255,0.10)",
    boxShadow: state.isFocused ? "0 0 0 1px rgba(201,168,76,0.18)" : "none",
    backgroundColor: state.isFocused ? "#24242c" : "#1c1c22",
    fontSize: "12.5px",
    color: "var(--color-text)",
    transition: "all 150ms ease",
    ":hover": {
      borderColor: "rgba(255,255,255,0.15)",
      backgroundColor: "#24242c",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    paddingInline: 12,
    paddingBlock: 0,
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
    background: "linear-gradient(180deg,#1b1b1e,#131316)",
    color: "var(--color-text)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    boxShadow: "0 12px 28px rgba(0, 0, 0, 0.38)",
    overflow: "hidden",
    padding: 4,
  }),
  menuList: (base) => ({
    ...base,
    padding: 0,
    background: "transparent",
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "rgba(212,168,88,0.14)"
      : state.isFocused
        ? "#1c1c22"
        : "transparent",
    color:
      state.isSelected || state.isFocused
        ? "var(--color-logo-primary)"
        : "var(--color-text)",
    borderRadius: 7,
    padding: "8px 10px",
    fontSize: "12.5px",
    cursor: state.isDisabled ? "not-allowed" : base.cursor,
    opacity: state.isDisabled ? 0.5 : 1,
    ":active": {
      backgroundColor: "rgba(212,168,88,0.18)",
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
