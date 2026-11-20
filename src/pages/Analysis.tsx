import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SolutionCard, type ImageAttachment } from "../components/SolutionCard";
import type { Solution } from "../domain";
import { runDemo, saveLocalRequest } from "../services/local";
import { Icon, Notice } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
export default function Analysis() {
  const t = useText();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [a, setA] = useState<Solution | null>(null);
  const [b, setB] = useState<Solution | null>(null);
  const [imageA, setImageA] = useState<ImageAttachment | null>(null);
  const [imageB, setImageB] = useState<ImageAttachment | null>(null);
  const [conditions, setConditions] = useState("");
  const [fail, setFail] = useState(false);
  const [error, setError] = useState("");
  const method = new URLSearchParams(location.search).get("method");
  useEffect(
    () => () => {
      if (imageA) URL.revokeObjectURL(imageA.url);
    },
    [imageA],
  );
  useEffect(
    () => () => {
      if (imageB) URL.revokeObjectURL(imageB.url);
    },
    [imageB],
  );
  function save(mode: "draft" | "demo") {
    if (!a || !b) return;
    try {
      const imageNotes = [
        imageA
          ? `A image selected: ${imageA.file.name} (not persisted or uploaded)`
          : "",
        imageB
          ? `B image selected: ${imageB.file.name} (not persisted or uploaded)`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      const r = saveLocalRequest(
        {
          a,
          b,
          conditions: [conditions, imageNotes].filter(Boolean).join("\n"),
        },
        mode,
      );
      void client.invalidateQueries({ queryKey: ["requests"] });
      navigate(`/requests/${r.id}`);
      if (mode === "demo")
        void runDemo(
          r.id,
          () => {
            void client.invalidateQueries({ queryKey: ["requests"] });
          },
          fail,
        ).catch(() => {
          void client.invalidateQueries({ queryKey: ["requests"] });
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("localDataError"));
    }
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow={t("steps")}
        title={t("newAnalysis")}
        description={t("analysisIntro")}
      />
      <Notice kind="warning">
        <strong>{t("review")}</strong> {t("reviewText")}
      </Notice>
      <div className="solutions-grid">
        <SolutionCard
          letter="A"
          value={a}
          onChange={setA}
          image={imageA}
          onImage={setImageA}
          initialMethod={method}
        />
        <div className="pair-connector">
          <Icon name="add" />
        </div>
        <SolutionCard
          letter="B"
          value={b}
          onChange={setB}
          image={imageB}
          onImage={setImageB}
        />
      </div>
      <section className="panel context-panel">
        <label className="field">
          <span className="label-icon">
            <Icon name="tune" />
            {t("conditions")}
          </span>
          <textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            rows={3}
            maxLength={2500}
            placeholder={t("conditionsHint")}
          />
        </label>
        <p className="small muted">{t("unknownFields")}</p>
      </section>
      <section className="submission-panel">
        <div>
          <h3>{t("analyzeCompatibility")}</h3>
          <p>{t("realDisabled")}</p>
        </div>
        <button disabled className="button primary">
          <Icon name="lock" />
          {t("analyzeCompatibility")}
        </button>
      </section>
      <div className="local-actions">
        <div>
          <p>{t("localNotice")}</p>
          <label className="check-field">
            <input
              type="checkbox"
              checked={fail}
              onChange={(e) => setFail(e.target.checked)}
            />
            {t("simulateFailure")}
          </label>
        </div>
        <div className="button-row">
          <button
            className="button outlined"
            disabled={!a || !b}
            onClick={() => save("draft")}
          >
            <Icon name="save" />
            {t("saveDraft")}
          </button>
          <button
            className="button subtle"
            disabled={!a || !b}
            onClick={() => save("demo")}
          >
            <Icon name="play_circle" />
            {t("demoRun")}
          </button>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
