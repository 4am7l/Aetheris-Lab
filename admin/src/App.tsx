import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CacheProvider } from "@emotion/react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import { ThemeProvider } from "@mui/material/styles";
import { TextContext } from "../../src/text";
import { createLabTheme, ltrCache, rtlCache } from "../../src/theme";
import { Icon, Notice } from "../../src/ui";
import ReviewWorkspace from "./ReviewWorkspace";
import { adminSession, adminSignOut, sessionQueryKey } from "./api";
import { adminText, type AdminTextKey } from "./i18n";
import { AdminTextContext, useAdminText } from "./text";

const systemColor = "(prefers-color-scheme: dark)";

function subscribeColor(callback: () => void) {
  const media = matchMedia(systemColor);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function isSystemDark() {
  return matchMedia(systemColor).matches;
}

function preference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Appearance preferences are optional.
  }
}

function Login() {
  const t = useAdminText();
  const { search } = useLocation();
  return (
    <section className="panel admin-login" aria-labelledby="reviewer-sign-in">
      <h1 id="reviewer-sign-in">{t("signInTitle")}</h1>
      <p className="muted">{t("signInDescription")}</p>
      {new URLSearchParams(search).get("auth") === "failed" && (
        <Notice kind="error">{t("signInFailed")}</Notice>
      )}
      <div>
        <Button href="/api/admin/auth/login" variant="contained">{t("signInWithGitHub")}</Button>
      </div>
    </section>
  );
}

export default function App() {
  const [language, setLanguage] = useState(() => preference("aetheris.lang") === "ar" ? "ar" : "en");
  const [theme, setTheme] = useState(() => preference("aetheris.theme"));
  const systemDark = useSyncExternalStore(subscribeColor, isSystemDark);
  const mode = theme === "dark" || (theme !== "light" && systemDark) ? "dark" : "light";
  const rtl = language === "ar";
  const materialTheme = useMemo(() => createLabTheme(mode, rtl ? "rtl" : "ltr"), [mode, rtl]);
  const t = (key: AdminTextKey) => adminText(key, language);
  const { pathname } = useLocation();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => adminSession(signal),
    refetchInterval: 60_000,
    retry: false,
    gcTime: 0,
  });
  const signOut = useMutation({
    mutationFn: adminSignOut,
    async onSuccess() {
      await client.cancelQueries({ queryKey: sessionQueryKey });
      client.setQueryData(sessionQueryKey, null);
    },
  });
  const reviewer = session.isError ? null : session.data;

  useEffect(() => {
    if (!reviewer) client.removeQueries({ queryKey: ["admin"] });
  }, [client, reviewer]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.dataset.theme = mode;
    storePreference("aetheris.lang", language);
    if (theme) storePreference("aetheris.theme", theme);
  }, [language, rtl, mode, theme]);

  useEffect(() => window.scrollTo(0, 0), [pathname]);

  return (
    <CacheProvider value={rtl ? rtlCache : ltrCache}>
      <ThemeProvider theme={materialTheme}>
        <TextContext value={t}>
          <AdminTextContext value={t}>
            <div className="admin-shell">
              <header className="admin-header">
                <Link to="/" className="admin-brand">
                  <span className="brand-symbol"><Icon name="science" /></span>
                  {t("admin")}
                </Link>
                <nav className="admin-controls" aria-label={t("dashboardNav")}>
                  {reviewer && <bdi className="admin-account">@{reviewer.login}</bdi>}
                  <IconButton
                    aria-label={t(mode === "dark" ? "switchToLight" : "switchToDark")}
                    onClick={() => setTheme(mode === "dark" ? "light" : "dark")}
                  >
                    <Icon name={mode === "dark" ? "light_mode" : "dark_mode"} />
                  </IconButton>
                  <button
                    type="button"
                    className="language-button"
                    aria-label={t("language")}
                    onClick={() => setLanguage(rtl ? "en" : "ar")}
                  >
                    <span lang={rtl ? "en" : "ar"}>{rtl ? "English" : "العربية"}</span>
                  </button>
                  {reviewer && (
                    <Button variant="outlined" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                      {t("signOut")}
                    </Button>
                  )}
                </nav>
              </header>
              <main className="admin-main" id="main">
                {session.isPending ? (
                  <div className="page" role="status">{t("loading")}</div>
                ) : session.isError ? (
                  <div className="page">
                    <Notice kind="error">{t("adminUnavailable")}</Notice>
                    <div><Button onClick={() => void session.refetch()}>{t("retry")}</Button></div>
                  </div>
                ) : reviewer ? (
                  <>
                    {signOut.isError && <div className="admin-session-error">
                      <Notice kind="error">{t("signOutFailed")}</Notice>
                    </div>}
                    <Routes>
                      <Route path="/" element={<ReviewWorkspace />} />
                      <Route path="/requests/:id" element={<ReviewWorkspace />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </>
                ) : <Login />}
              </main>
            </div>
          </AdminTextContext>
        </TextContext>
      </ThemeProvider>
    </CacheProvider>
  );
}
