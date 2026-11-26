import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SolutionCard, type ImageAttachment } from "../components/SolutionCard";
import { dilutionVolumeSchema, type RequestInput, type Solution } from "../domain";
import { saveLocalRequest } from "../services/local";
import { RequestError, submitRequest } from "../services/publicRequests";
import { useRetryDelay } from "../services/useRetryDelay";
import { Icon, Modal, Notice } from "../ui";
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
  const [attachPhotos, setAttachPhotos] = useState(false);
  const [conditions, setConditions] = useState("");
  const [calculationKind, setCalculationKind] = useState<NonNullable<RequestInput["calculation"]>["kind"]>();
  const [finalVolume, setFinalVolume] = useState("");
  const [finalVolumeUnit, setFinalVolumeUnit] = useState<"L" | "mL">("mL");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestError>();
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const cooldown = useRetryDelay(failure?.retryAt ?? 0);
  const method = new URLSearchParams(location.search).get("method");

  useEffect(() => {
    active.current = location.pathname === "/analysis";
    return () => {
      active.current = false;
    };
  }, [location.pathname]);
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

  const invalidVolume = Boolean(calculationKind && finalVolume.trim()) && !dilutionVolumeSchema.safeParse(finalVolume).success;
  const input: RequestInput | undefined = a && b ? {
    a, b, conditions,
    ...(calculationKind ? { calculation: {
      kind: calculationKind, assumptionsConfirmed: true,
      ...(finalVolume.trim() ? { finalVolume: { value: finalVolume, unit: finalVolumeUnit } } : {}),
    } } : {}),
  } : undefined;

  function saveDraft() {
    if (!input || invalidVolume || inFlight.current) return;
    try {
      const draft = saveLocalRequest(input);
      void client.invalidateQueries({ queryKey: ["requests"] });
      navigate("/requests/" + draft.id);
    } catch {
      setDraftError(true);
    }
  }

  async function submit() {
    if (!input || invalidVolume || inFlight.current || cooldown) return;
    // Lock synchronously before React renders the disabled button.
    inFlight.current = true;
    setConfirmRetry(false);
    setPending(true);
    setFailure(undefined);
    setDraftError(false);
    try {
      const id = await submitRequest(
        input,
        attachPhotos ? { imageA: imageA?.file, imageB: imageB?.file } : undefined,
      );
      if (active.current)
        navigate("/requests/" + id + "/receipt", { replace: true });
    } catch (error) {
      inFlight.current = false;
      if (active.current) {
        setFailure(
          error instanceof RequestError
            ? error
            : new RequestError("unconfirmed"),
        );
        setPending(false);
      }
    }
  }

  return (
    <div className="page">
      <PageHeading title={t("newAnalysis")} description={t("analysisIntro")} />
      <Notice kind="warning">
        <strong>{t("review")}</strong> {t("reviewText")}
      </Notice>
      <fieldset className="request-fields" disabled={pending}>
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
          <TextField
            fullWidth
            multiline
            rows={3}
            label={t("conditions")}
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            placeholder={t("conditionsHint")}
            slotProps={{ htmlInput: { maxLength: 3000 } }}
          />
          <p className="small muted">{t("unknownFields")}</p>
          <FormControlLabel
            label={t("dilutionOptIn")}
            control={<Checkbox checked={calculationKind === "aqueous-dilution"}
              onChange={(_, checked) => setCalculationKind(checked ? "aqueous-dilution" : undefined)}
              slotProps={{ input: { "aria-describedby": "dilution-assumptions" } }} />}
          />
          <p id="dilution-assumptions" className="small muted">{t("dilutionAssumptions")}</p>
          <FormControlLabel
            label={t("saltOptIn")}
            control={<Checkbox checked={calculationKind === "aqueous-sodium-chloride"}
              onChange={(_, checked) => setCalculationKind(checked ? "aqueous-sodium-chloride" : undefined)}
              slotProps={{ input: { "aria-describedby": "salt-assumptions" } }} />}
          />
          <p id="salt-assumptions" className="small muted">{t("saltAssumptions")}</p>
          {calculationKind && <div className="form-grid">
            <TextField
              label={t("dilutionFinalVolume")}
              value={finalVolume}
              onChange={(event) => setFinalVolume(event.target.value)}
              error={invalidVolume}
              helperText={invalidVolume ? t("dilutionVolumeInvalid") : undefined}
              slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 64 } }}
            />
            <TextField select label={t("dilutionFinalVolumeUnit")} value={finalVolumeUnit}
              onChange={(event) => setFinalVolumeUnit(event.target.value === "L" ? "L" : "mL")}>
              <MenuItem value="mL">mL</MenuItem>
              <MenuItem value="L">L</MenuItem>
            </TextField>
          </div>}
        </section>
      </fieldset>
      <section className="submission-panel" aria-busy={pending}>
        <div>
          <h3>{t("submitRequest")}</h3>
          <p>{t("submissionNotice")}</p>
          {attachPhotos && (imageA || imageB) && <p>{t("photosPrivate")}</p>}
        </div>
        {(imageA || imageB) && (
          <FormControlLabel
            label={t("attachReviewPhotos")}
            control={<Checkbox checked={attachPhotos} disabled={pending} onChange={(_, value) => setAttachPhotos(value)} />}
          />
        )}
        <Button
          variant="contained"
          disabled={!input || invalidVolume || pending || cooldown}
          onClick={() =>
            failure?.code === "unconfirmed"
              ? setConfirmRetry(true)
              : void submit()
          }
        >
          {pending
            ? t("submitting")
            : failure
              ? t("retry")
              : t("submitRequest")}
        </Button>
      </section>
      <span role="status" className="sr-only">
        {pending && t("submitting")}
      </span>
      {failure && (
        <Notice kind="error">
          {failure.code === "unconfirmed"
            ? t("submissionUnconfirmed")
            : failure.code === "rateLimited"
              ? t(cooldown ? "rateLimited" : "retryAvailable")
              : failure.code === "validation"
                ? t("submissionInvalid")
                : t("submissionRejected")}
        </Notice>
      )}
      <div className="local-actions">
        <p>{t("localNotice")}</p>
        <Button
          variant="outlined"
          disabled={!input || invalidVolume || pending}
          onClick={saveDraft}
        >
          <Icon name="save" />
          {t("saveDraft")}
        </Button>
      </div>
      {draftError && <Notice kind="error">{t("localDataError")}</Notice>}
      {confirmRetry && (
        <Modal
          title={t("retrySubmission")}
          onClose={() => setConfirmRetry(false)}
        >
          <p>{t("submissionUnconfirmed")}</p>
          <div className="button-row">
            <Button onClick={() => setConfirmRetry(false)}>
              {t("cancel")}
            </Button>
            <Button variant="contained" onClick={() => void submit()}>
              {t("submitAgain")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
