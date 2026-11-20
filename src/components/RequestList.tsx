import { Link } from "react-router-dom";
import type { LocalRequest } from "../domain";
import { Icon } from "../ui";
import { useText } from "../text";
export default function RequestList({
  requests,
}: {
  requests: LocalRequest[];
}) {
  const t = useText();
  return (
    <div className="request-list">
      {requests.map((r) => (
        <Link className="request-row" key={r.id} to={`/requests/${r.id}`}>
          <span className="request-icon">
            <Icon name="science" />
          </span>
          <div>
            <strong>
              {r.a.name} <span className="muted">+</span> {r.b.name}
            </strong>
            <small>
              {r.id.slice(0, 8).toUpperCase()} ·{" "}
              {new Date(r.createdAt).toLocaleString(
                document.documentElement.lang,
              )}{" "}
              · {r.mode === "demo" ? "DEMO" : t("draft")}
            </small>
          </div>
          <span
            className={`status-pill ${r.status === "Failed" ? "error-pill" : ""}`}
          >
            {r.status}
          </span>
        </Link>
      ))}
    </div>
  );
}
