import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listLocalRequests } from "../services/local";
import { Icon, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
import RequestList from "../components/RequestList";
export default function Requests() {
  const t = useText();
  const q = useQuery({ queryKey: ["requests"], queryFn: listLocalRequests });
  return (
    <div className="page">
      <div className="heading-with-action">
        <PageHeading
          eyebrow={t("localMode")}
          title={t("requests")}
          description={t("requestIntro")}
        />
        <Link className="button primary" to="/analysis">
          <Icon name="add" />
          {t("new")}
        </Link>
      </div>
      <Notice>{t("localNotice")}</Notice>
      {q.isPending ? (
        <div className="skeleton" />
      ) : q.isError ? (
        <Notice kind="error">
          {q.error.message}
          <button className="button subtle" onClick={() => void q.refetch()}>
            {t("retry")}
          </button>
        </Notice>
      ) : q.data.length ? (
        <section className="panel">
          <RequestList requests={q.data} />
        </section>
      ) : (
        <div className="panel empty-state">
          <span className="empty-icon">
            <Icon name="assignment" />
          </span>
          <h2>{t("noRequests")}</h2>
          <p>{t("noRequestsText")}</p>
          <Link className="button primary" to="/analysis">
            {t("newAnalysis")}
          </Link>
        </div>
      )}
    </div>
  );
}
