import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AgentReport } from "./AgentReport";
import { ApprovedResultPanel } from "../../src/components/ApprovedResultPanel";
import PageHeading from "../../src/components/PageHeading";
import { ReviewForm } from "./ReviewForm";
import { publicRequestStatuses, type PublicRequestStatus, type Solution } from "../../src/domain";
import { statusLabel } from "../../src/reviewText";
import { adminAction, adminDetail, AdminError, adminImage, adminList, sessionQueryKey } from "./api";
import { useAdminText as useText } from "./text";
import { Icon, Notice } from "../../src/ui";

function DateLabel({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(document.documentElement.lang || undefined)}</time>;
}

function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useText();
  return (
    <Notice kind="error">
      {t(error instanceof AdminError && ![401, 403, 503].includes(error.status)
        ? "adminReadError" : "adminUnavailable")}
      <div><Button onClick={retry}>{t("retry")}</Button></div>
    </Notice>
  );
}

function ReviewQueue() {
  const t = useText();
  const [status, setStatus] = useState<PublicRequestStatus | "">("");
  const queue = useInfiniteQuery({
    queryKey: ["admin", "queue", status],
    queryFn: ({ pageParam, signal }) => adminList(status, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: ({ next }) => next ?? undefined,
    retry: false,
    gcTime: 0,
  });
  const requests = queue.data?.pages.flatMap((page) => page.requests) ?? [];

  return (
    <div className="page">
      <PageHeading title={t("adminQueue")} />
      <div className="admin-toolbar">
        <TextField select fullWidth label={t("reviewerFilter")} value={status || "all"}
          onChange={(event) => setStatus(event.target.value === "all" ? "" : event.target.value as PublicRequestStatus)}>
          <MenuItem value="all">{t("all")}</MenuItem>
          {publicRequestStatuses.map((value) =>
            <MenuItem key={value} value={value}>{t(statusLabel[value])}</MenuItem>,
          )}
        </TextField>
        <Button variant="outlined" disabled={queue.isFetching} onClick={() => void queue.refetch()}>
          {t("refreshReceipt")}
        </Button>
      </div>
      {queue.isPending && <p role="status">{t("loading")}</p>}
      {queue.isError && <ReadError error={queue.error} retry={() => void queue.refetch()} />}
      {queue.isSuccess && (
        requests.length ? (
          <div className="request-list">
            {requests.map((request) => (
              <Link key={request.id} to={"/requests/" + request.id} className="request-row">
                <span className="request-icon"><Icon name="assignment" /></span>
                <div>
                  <strong><bdi>{request.nameA}</bdi> · <bdi>{request.nameB}</bdi></strong>
                  <small><bdi>{request.id.slice(0, 8)}</bdi> · <DateLabel value={request.createdAt} /></small>
                </div>
                <span className="status-pill">{t(statusLabel[request.status])}</span>
              </Link>
            ))}
          </div>
        ) : <div className="empty-state">{t("adminEmpty")}</div>
      )}
      {queue.hasNextPage && !queue.isError && <Button variant="outlined" disabled={queue.isFetching}
        onClick={() => void queue.fetchNextPage()}>
        {queue.isFetchingNextPage ? t("loading") : t("loadMore")}
      </Button>}
    </div>
  );
}

const solutionFields = [
  "name", "formula", "cas", "concentration", "unit", "solvent",
  "state", "temperature", "quantity", "quantityUnit", "notes",
] as const;

function SubmittedSolution({ side, data }: { side: "A" | "B"; data: Solution }) {
  const t = useText();
  return (
    <section>
      <h3>{t("solution")} {side}</h3>
      <dl className="admin-fields">
        {solutionFields.map((field) => (
          <div key={field}>
            <dt>{t(field)}</dt>
            <dd dir="auto">{data[field] === "Unknown" ? t("unknown") : data[field] || "—"}</dd>
          </div>
        ))}
        <div>
          <dt>{t("submittedSource")}</dt>
          <dd>{t(data.source === "Manual entry" ? "manualSource" : "catalogSource")}</dd>
        </div>
      </dl>
    </section>
  );
}

function RequestReview({ id, csrfToken }: { id: string; csrfToken: string }) {
  const t = useText();
  const client = useQueryClient();
  const queryKey = ["admin", "request", id];
  const detail = useQuery({
    queryKey,
    queryFn: ({ signal }) => adminDetail(id, signal),
    refetchInterval: ({ state }) => !state.error &&
      (state.data?.status === "Submitted" || state.data?.status === "Analyzing") ? 15_000 : false,
    retry: false,
    gcTime: 0,
  });
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: "decision" | "retry"; body: unknown }) =>
      adminAction(id, action, body, csrfToken),
    onError(error) {
      if (error instanceof AdminError && [401, 403].includes(error.status)) {
        void client.invalidateQueries({ queryKey: sessionQueryKey });
      }
    },
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({ queryKey: ["admin", "queue"] }),
    ]),
    gcTime: 0,
  });
  const request = detail.isSuccess ? detail.data : undefined;

  return (
    <div className="page">
      <Link to="/" className="text-link">{t("back")} · {t("adminQueue")}</Link>
      <PageHeading title={t("adminRequest")} />
      {detail.isPending && <p role="status">{t("loading")}</p>}
      {detail.isError && <ReadError error={detail.error} retry={() => void detail.refetch()} />}
      {mutation.isError && <Notice kind="error">
        {t(mutation.error instanceof AdminError && mutation.error.status === 409 ? "adminStale" : "adminWriteError")}
      </Notice>}
      {mutation.isSuccess && <div role="status"><Notice>{t("adminSaved")}</Notice></div>}
      {request && (
        <div className="admin-review-cards">
          <div className="panel request-metadata">
            <div><span>{t("requestId")}</span><strong className="mono"><bdi>{id}</bdi></strong></div>
            <div><span>{t("created")}</span><strong><DateLabel value={request.createdAt} /></strong></div>
            <div><span>{t("status")}</span><strong>{t(statusLabel[request.status])}</strong></div>
          </div>
          <section className="panel admin-section">
            <h2>{t("submittedDetails")}</h2>
            <div className="admin-grid">
              <SubmittedSolution side="A" data={request.input.a} />
              <SubmittedSolution side="B" data={request.input.b} />
            </div>
            <section>
              <h3>{t("conditions")}</h3>
              <p dir="auto">{request.input.conditions || "—"}</p>
            </section>
            <section>
              <h3>{t("privatePhotos")}</h3>
              {!request.images.length && <p className="muted">{t("adminPhotoMissing")}</p>}
              <div className="admin-grid">
                {request.images.map((image) => (
                  <figure className="admin-photo" key={image.id}>
                    <img src={adminImage(id, image.id)} loading="lazy" alt={`${t("photo")} · ${t("solution")} ${image.solution}`} />
                    <figcaption>{t("solution")} {image.solution}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          </section>
          <AgentReport request={request} />
          {request.canRetry && request.run && <div>
            <Button variant="outlined" disabled={mutation.isPending}
              onClick={() => mutation.mutate({ action: "retry", body: { runId: request.run?.id } })}>
              {t("retryAgent")}
            </Button>
          </div>}
          {request.status === "Pending Review" && request.run && (
            <ReviewForm key={request.run.id} request={request} busy={mutation.isPending}
              onSubmit={(body) => mutation.mutate({ action: "decision", body })} />
          )}
          {request.review && (
            <section className="panel admin-section">
              <h2>{t("reviewDecision")}</h2>
              <p><strong>{t(statusLabel[request.review.decision])}</strong> · <bdi>{request.review.reviewerId}</bdi> · <DateLabel value={request.review.createdAt} /></p>
              <h3>{t("reviewerNotes")}</h3>
              <p dir="auto">{request.review.notes}</p>
            </section>
          )}
          {request.approvedResult && <ApprovedResultPanel result={request.approvedResult} />}
          <section className="panel admin-section">
            <h2>{t("history")}</h2>
            {!request.history.length && <p>{t("noHistory")}</p>}
            <ol className="admin-history">
              {request.history.map((item) => (
                <li key={item.id}>
                  <strong>{t(statusLabel[item.status])}</strong> · <DateLabel value={item.createdAt} /> ·{" "}
                  <bdi>{item.actor === "requester" ? t("requesterActor") : item.actor === "agent" ? t("agentActor") : item.actor}</bdi>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

export default function ReviewWorkspace({ csrfToken }: { csrfToken: string }) {
  const { id } = useParams();
  return id ? <RequestReview key={id} id={id} csrfToken={csrfToken} /> : <ReviewQueue />;
}
