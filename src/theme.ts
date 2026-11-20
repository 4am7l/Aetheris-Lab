import { createTheme } from "@mui/material/styles";
import createCache from "@emotion/cache";
import rtlPlugin from "@mui/stylis-plugin-rtl";
import { prefixer } from "stylis";

export const ltrCache = createCache({ key: "aetheris" });
export const rtlCache = createCache({
  key: "aetheris-rtl",
  stylisPlugins: [prefixer, rtlPlugin],
});

export function createLabTheme(
  mode: "light" | "dark",
  direction: "ltr" | "rtl",
) {
  const dark = mode === "dark";
  return createTheme({
    direction,
    palette: {
      mode,
      primary: { main: dark ? "#a8c7fa" : "#0b57d0" },
      background: {
        default: dark ? "#131314" : "#f8fafd",
        paper: dark ? "#1e1f20" : "#ffffff",
      },
      text: {
        primary: dark ? "#e3e3e3" : "#1f1f1f",
        secondary: dark ? "#c4c7c5" : "#5f6368",
      },
      divider: dark ? "#3c4043" : "#e1e3e1",
    },
    typography: {
      fontFamily: 'Roboto, "Noto Sans Arabic", sans-serif',
      fontSize: 14,
      h1: { fontWeight: 400 },
      h2: { fontWeight: 400 },
      button: { textTransform: "none", fontWeight: 500, letterSpacing: 0 },
    },
    shape: { borderRadius: 16 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 24,
            minHeight: 44,
            padding: "10px 22px",
            fontSize: 14,
          },
          outlined: { borderColor: dark ? "#5f6368" : "#747775" },
          text: { padding: "10px 18px" },
          contained: {
            backgroundColor: dark ? "#a8c7fa" : "#0b57d0",
            color: dark ? "#062e6f" : "#ffffff",
            "&:hover": { backgroundColor: dark ? "#bfd6fc" : "#0848b3" },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { color: dark ? "#c4c7c5" : "#444746", width: 44, height: 44 },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 9, height: 36, fontWeight: 500, fontSize: 14 },
          outlined: { borderColor: dark ? "#5f6368" : "#c4c7c5" },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 12, fontSize: 16 },
          notchedOutline: { borderColor: dark ? "#5f6368" : "#c4c7c5" },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 28,
            backgroundImage: "none",
            maxHeight: "calc(100dvh - 48px)",
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 28,
            gap: 14,
            minHeight: 52,
            padding: "12px 22px",
            fontSize: 14,
            fontWeight: 500,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { borderRadius: 8, fontSize: 12 } },
      },
    },
  });
}
