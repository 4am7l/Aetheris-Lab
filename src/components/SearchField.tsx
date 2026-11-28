import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import { useRef } from "react";
import { Icon } from "../ui";

type Props = Pick<TextFieldProps, "name" | "placeholder" | "helperText" | "value" | "defaultValue" | "onChange" | "required" | "autoFocus"> & {
  accessibleName: string;
  clear?: { label: string; action: () => void };
};

export default function SearchField({ accessibleName, clear, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);

  return <TextField
    {...props}
    className="search-field"
    fullWidth
    inputRef={input}
    type="search"
    slotProps={{
      htmlInput: { "aria-label": accessibleName, enterKeyHint: "search" },
      input: {
        startAdornment: <InputAdornment position="start"><Icon name="search" /></InputAdornment>,
        endAdornment: clear && <InputAdornment position="end">
          <IconButton aria-label={clear.label} onClick={() => {
            input.current?.focus();
            clear.action();
          }}><Icon name="close" /></IconButton>
        </InputAdornment>,
      },
    }}
  />;
}
