import {
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { en, ar, type TextKey } from "./i18n";
import { TextContext } from "./text";
import { Icon } from "./ui";
import Home from "./pages/Home";
const Analysis = lazy(() => import("./pages/Analysis"));
const Library = lazy(() => import("./pages/Library"));
const ChemicalDetail = lazy(() => import("./pages/ChemicalDetail"));
const Requests = lazy(() => import("./pages/Requests"));
const RequestDetail = lazy(() => import("./pages/RequestDetail"));
const About = lazy(() => import("./pages/About"));
const nav = [
  ["/", "home", "space_dashboard"],
  ["/analysis", "analysis", "science"],
  ["/library", "library", "dictionary"],
  ["/requests", "requests", "assignment"],
  ["/about", "about", "info"],
] as const;
function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function subscribeMobile(callback: () => void) {
  const media = matchMedia("(max-width: 640px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function isMobile() {
  return matchMedia("(max-width: 640px)").matches;
}
export default function App() {
  const [lang, setLang] = useState(() => preference("aetheris.lang", "en"));
  const [theme, setTheme] = useState(() =>
    preference("aetheris.theme", "system"),
  );
  const [menu, setMenu] = useState(false);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (menu && mobile)
      sidebar.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
  }, [menu, mobile]);
  const location = useLocation();
  const t = (key: TextKey) => (lang === "ar" ? (ar[key] ?? en[key]) : en[key]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("aetheris.lang", lang);
    } catch {
      /* Browser storage may be blocked. */
    }
  }, [lang]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    update();
    media.addEventListener("change", update);
    try {
      localStorage.setItem("aetheris.theme", theme);
    } catch {
      /* Nonessential preference. */
    }
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <TextContext value={t}>
      <MotionConfig reducedMotion="user">
        <div className="app-shell">
          <aside
            ref={sidebar}
            className={`sidebar ${menu ? "open" : ""}`}
            inert={mobile && !menu}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenu(false);
            }}
          >
            <Link to="/" className="brand">
              <span className="brand-symbol">
                <Icon name="science" />
              </span>
              <span>
                Aetheris<span className="brand-lab"> Lab</span>
                <small>CLARITY IN CHEMISTRY</small>
              </span>
            </Link>
            <div className="nav-label">{t("workspace")}</div>
            <nav aria-label="Main navigation" onClick={() => setMenu(false)}>
              {nav.map(([path, key, icon]) => (
                <NavLink end={path === "/"} to={path} key={path}>
                  <Icon name={icon} />
                  <span>{t(key)}</span>
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="review-mini">
                <Icon name="verified_user" />
                <strong>{t("review")}</strong>
                <p>{t("reviewText")}</p>
              </div>
              <div className="local-indicator">
                <span className="dot" />
                {t("localMode")}
                <span className="version">v0.1</span>
              </div>
            </div>
          </aside>
          {menu && (
            <button
              className="mobile-scrim"
              aria-label={t("close")}
              onClick={() => setMenu(false)}
            />
          )}
          <div className="main-shell" inert={mobile && menu}>
            <header className="topbar">
              <div className="breadcrumb">
                <button
                  className="icon-button mobile-toggle"
                  aria-label={t("mobileMenu")}
                  onClick={() => setMenu((v) => !v)}
                >
                  <Icon name="menu" />
                </button>
                <span className="muted">{t("workspace")}</span>
                <span className="breadcrumb-slash">/</span>
                <strong>
                  {t(
                    nav.find(([p]) =>
                      p === "/"
                        ? location.pathname === "/"
                        : location.pathname.startsWith(p),
                    )?.[1] ?? "home",
                  )}
                </strong>
              </div>
              <div className="top-actions">
                <span className="demo-badge">
                  <span className="dot" />
                  {t("demo")}
                </span>
                <label className="compact-select">
                  <span className="sr-only">{t("theme")}</span>
                  <Icon
                    name={
                      theme === "dark"
                        ? "dark_mode"
                        : theme === "light"
                          ? "light_mode"
                          : "contrast"
                    }
                  />
                  <select
                    aria-label={t("theme")}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="system">{t("system")}</option>
                    <option value="light">{t("light")}</option>
                    <option value="dark">{t("dark")}</option>
                  </select>
                </label>
                <button
                  className="language-button"
                  onClick={() => setLang(lang === "en" ? "ar" : "en")}
                  aria-label={t("language")}
                >
                  {lang === "en" ? "العربية" : "English"}
                </button>
              </div>
            </header>
            <main id="main">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <Suspense
                    fallback={
                      <div
                        className="page skeleton"
                        role="status"
                        aria-label={t("loading")}
                      />
                    }
                  >
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/analysis" element={<Analysis />} />
                      <Route path="/library" element={<Library />} />
                      <Route path="/library/:id" element={<ChemicalDetail />} />
                      <Route path="/requests" element={<Requests />} />
                      <Route path="/requests/:id" element={<RequestDetail />} />
                      <Route path="/about" element={<About />} />
                      <Route
                        path="*"
                        element={
                          <div className="empty-state">
                            <h1>404</h1>
                            <Link to="/">{t("home")}</Link>
                          </div>
                        }
                      />
                    </Routes>
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            </main>
            <footer>
              <span className="footer-brand">
                <Icon name="science" /> Aetheris Lab
              </span>
              <span>{t("footer")}</span>
              <span className="small">{t("demo")} · v0.1</span>
            </footer>
          </div>
        </div>
      </MotionConfig>
    </TextContext>
  );
}
