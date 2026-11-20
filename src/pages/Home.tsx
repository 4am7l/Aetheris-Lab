import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listLocalRequests } from "../services/local";
import { Icon, Molecule, Notice } from "../ui";
import { useText } from "../text";
import type { TextKey } from "../i18n";
import RequestList from "../components/RequestList";
export default function Home() {
  const t = useText();
  const recent = useQuery({
    queryKey: ["requests"],
    queryFn: listLocalRequests,
  });
  return (
    <div className="page home-page">
      <div className="eyebrow">{t("welcome")}</div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-chip">
            <Icon name="hub" /> {t("steps")}
          </span>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
          <div className="button-row">
            <Link className="button primary" to="/analysis">
              <Icon name="science" />
              {t("analyze")}
            </Link>
            <Link className="button outlined" to="/library">
              {t("explore")}
            </Link>
          </div>
        </div>
        <div className="hero-visual">
          <div className="orbit-ring" />
          <Molecule />
          <span className="molecule-label">
            <span className="dot" /> EVIDENCE. INSIGHT. OVERSIGHT.
          </span>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>{t("start")}</h2>
          <p>{t("startText")}</p>
        </div>
        <span className="section-meta">
          <Icon name="encrypted" />
          {t("safety")}
        </span>
      </div>
      <div className="quick-grid">
        <Link className="quick-card blue" to="/analysis?method=camera">
          <span className="quick-icon">
            <Icon name="photo_camera" />
          </span>
          <div>
            <h3>{t("camera")}</h3>
            <p>Capture a chemical label</p>
          </div>
          <Icon name="add" className="quick-plus" />
        </Link>
        <Link className="quick-card violet" to="/analysis?method=manual">
          <span className="quick-icon">
            <Icon name="edit_note" />
          </span>
          <div>
            <h3>{t("manual")}</h3>
            <p>Add the details you know</p>
          </div>
          <Icon name="add" className="quick-plus" />
        </Link>
        <Link className="quick-card cyan" to="/library">
          <span className="quick-icon">
            <Icon name="dictionary" />
          </span>
          <div>
            <h3>{t("search")}</h3>
            <p>Explore source-backed entries</p>
          </div>
          <Icon name="search" className="quick-plus" />
        </Link>
      </div>
      <div className="home-lower">
        <section className="panel recent-panel">
          <div className="section-heading">
            <h2>{t("recent")}</h2>
            <Link className="text-link" to="/requests">
              {t("viewAll")}
            </Link>
          </div>
          {recent.isPending ? (
            <div className="skeleton" />
          ) : recent.isError ? (
            <Notice kind="error">{recent.error.message}</Notice>
          ) : recent.data.length ? (
            <RequestList requests={recent.data.slice(0, 3)} />
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <Icon name="assignment_add" />
              </span>
              <h3>{t("noRequests")}</h3>
              <p>{t("noRequestsText")}</p>
              <Link className="text-link" to="/analysis">
                {t("newAnalysis")}
              </Link>
            </div>
          )}
        </section>
        <section className="panel services-panel">
          <h2>{t("services")}</h2>
          {[
            ["dictionary", "catalog", "available", true],
            ["auto_awesome", "ai", "offline", false],
            ["admin_panel_settings", "admin", "pending", false],
          ].map(([icon, label, status, online]) => (
            <div className="service-row" key={String(label)}>
              <Icon name={String(icon)} />
              <span>
                <strong>{t(label as TextKey)}</strong>
                <small>
                  <span className={`dot ${online ? "" : "gray"}`} />
                  {t(status as TextKey)}
                </small>
              </span>
              {online && <Icon name="check_circle" className="online-check" />}
            </div>
          ))}
          <div className="service-note">
            <Icon name="info" />
            <p>
              Live analysis and submissions are not available in this
              environment.
            </p>
          </div>
        </section>
      </div>
      <section className="how-section">
        <div>
          <span className="eyebrow">{t("how")}</span>
          <h2>{t("titleShort")}</h2>
        </div>
        <div className="how-grid">
          {[
            ["fingerprint", "identify", "identifyText"],
            ["travel_explore", "research", "researchText"],
            ["verified_user", "expert", "expertText"],
          ].map(([icon, title, desc]) => (
            <div className="how-item" key={title}>
              <span className="how-icon">
                <Icon name={icon} />
              </span>
              <h3>{t(title as TextKey)}</h3>
              <p>{t(desc as TextKey)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
