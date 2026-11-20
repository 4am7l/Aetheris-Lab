import { useText } from "../text";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  blankSolution,
  solutionSchema,
  unknown,
  validateImage,
  type Solution,
} from "../domain";
import { catalog } from "../services/local";
import { Icon, Modal, Notice } from "../ui";
type Method = "manual" | "search" | "camera" | null;
export interface ImageAttachment {
  file: File;
  url: string;
}
export function SolutionCard({
  letter,
  value,
  onChange,
  image,
  onImage,
  initialMethod,
}: {
  letter: "A" | "B";
  value: Solution | null;
  onChange: (v: Solution | null) => void;
  image: ImageAttachment | null;
  onImage: (v: ImageAttachment | null) => void;
  initialMethod?: string | null;
}) {
  const t = useText();
  const [method, setMethod] = useState<Method>(
    initialMethod === "camera"
      ? "camera"
      : initialMethod === "manual"
        ? "manual"
        : null,
  );
  const [form, setForm] = useState<Solution>(value ?? { ...blankSolution });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const results = useQuery({
    queryKey: ["catalog", query],
    queryFn: () => catalog.search(query),
    enabled: method === "search",
  });
  const update = (key: keyof Solution, v: string) =>
    setForm((f) => ({
      ...f,
      [key]: v,
      source: ["name", "formula", "cas"].includes(key)
        ? "Manual entry"
        : f.source,
    }));
  function accept(file?: File) {
    if (!file) return;
    const issue = validateImage(file);
    if (issue) {
      setError(issue);
      return;
    }
    onImage({ file, url: URL.createObjectURL(file) });
    setForm(value ?? { ...blankSolution });
    setErrors({});
    setError("");
    setMethod("manual");
  }
  function manual() {
    setForm(value ?? { ...blankSolution });
    setErrors({});
    setMethod("manual");
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = solutionSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
        ),
      );
      return;
    }
    onChange(parsed.data);
    setMethod(null);
  }
  const field = (key: keyof Solution, label: string, numeric = false) => (
    <div className="field" key={key}>
      <label htmlFor={`input-${letter}-${key}`}>{label}</label>
      <div className="unknown-field">
        <input
          id={`input-${letter}-${key}`}
          value={form[key]}
          onChange={(e) => update(key, e.target.value)}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `error-${letter}-${key}` : undefined}
          inputMode={numeric ? "decimal" : undefined}
          maxLength={200}
          required
        />
        {key !== "name" && (
          <button
            type="button"
            className="unknown-button"
            aria-label={`${t("unknown")}: ${label}`}
            onClick={() => update(key, form[key] === unknown ? "" : unknown)}
          >
            {form[key] === unknown ? t("editUnknown") : t("unknown")}
          </button>
        )}
      </div>
      {errors[key] && (
        <small id={`error-${letter}-${key}`} className="field-error">
          {errors[key]}
        </small>
      )}
    </div>
  );
  return (
    <>
      <section className={`solution-card ${value ? "filled" : ""}`}>
        <div className="solution-top">
          <span className={`solution-letter ${letter.toLowerCase()}`}>
            {letter}
          </span>
          <div>
            <h3>
              {t("solution")} {letter}
            </h3>
            <span className="muted small">
              {value ? t("ready") : t("selectText")}
            </span>
          </div>
          {value && (
            <button
              className="icon-button ml-auto"
              onClick={() => onChange(null)}
              aria-label={`${t("remove")} ${t("solution")} ${letter}`}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        {image && (
          <div className="image-strip">
            <img src={image.url} alt={`${t("photo")} ${letter}`} />
            <div>
              <strong>{t("photo")}</strong>
              <p>{t("imageUnavailable")}</p>
            </div>
            <button
              className="icon-button"
              aria-label={t("clearImage")}
              onClick={() => onImage(null)}
            >
              <Icon name="delete" />
            </button>
          </div>
        )}
        {value ? (
          <div className="chemical-summary">
            <div className="formula">{value.formula}</div>
            <h3>{value.name}</h3>
            <div className="summary-grid">
              <span>
                {t("cas")}
                <strong>{value.cas}</strong>
              </span>
              <span>
                {t("concentration")}
                <strong>
                  {value.concentration === "Unknown"
                    ? t("unknown")
                    : `${value.concentration} ${value.unit}`}
                </strong>
              </span>
              <span>
                {t("state")}
                <strong>{value.state}</strong>
              </span>
              <span>
                {t("identifySource")}
                <strong>{value.source}</strong>
              </span>
            </div>
            <p className="small muted">{t("confidence")}</p>
            <button className="button subtle full" onClick={manual}>
              <Icon name="edit" />
              {t("replace")}
            </button>
          </div>
        ) : (
          <div className="solution-empty">
            <div className={`flask-icon ${letter.toLowerCase()}`}>
              <Icon name={letter === "A" ? "science" : "experiment"} />
            </div>
            <h3>{t("select")}</h3>
            <p>{t("selectText")}</p>
          </div>
        )}
        <div className="method-grid">
          <button onClick={() => setMethod("camera")}>
            <Icon name="photo_camera" />
            {t("camera")}
          </button>
          <button onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            {t("upload")}
          </button>
          <button onClick={() => setMethod("search")}>
            <Icon name="search" />
            {t("search")}
          </button>
          <button onClick={manual}>
            <Icon name="edit_note" />
            {t("manual")}
          </button>
        </div>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = "";
          }}
          aria-label={`${t("upload")} ${letter}`}
        />
        {error && <Notice kind="error">{error}</Notice>}
      </section>
      {method === "camera" && (
        <Camera
          onClose={() => setMethod(null)}
          onCapture={accept}
          onFallback={() => {
            setMethod(null);
            fileRef.current?.click();
          }}
        />
      )}
      {method === "search" && (
        <Modal
          title={`${t("searchSelect")} · ${letter}`}
          onClose={() => setMethod(null)}
        >
          <div className="search-box">
            <Icon name="search" />
            <input
              autoFocus
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="small muted">{t("sourceSelection")}</p>
          <div className="search-results">
            {results.isPending ? (
              <div className="skeleton" />
            ) : results.isError ? (
              <Notice kind="error">{t("error")}</Notice>
            ) : results.data.length ? (
              results.data.map((c) => (
                <button
                  className="search-result"
                  key={c.id}
                  onClick={() => {
                    setForm({
                      ...blankSolution,
                      name: c.name,
                      formula: c.formula,
                      cas: c.cas,
                      source: "NIOSH catalog",
                    });
                    setMethod("manual");
                    setErrors({});
                  }}
                >
                  <span className="mini-formula">{c.formula}</span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      CAS {c.cas} · {c.category}
                    </small>
                  </span>
                  <Icon name="add_circle" />
                </button>
              ))
            ) : (
              <p>{t("empty")}</p>
            )}
          </div>
        </Modal>
      )}
      {method === "manual" && (
        <Modal
          title={`${t("solution")} ${letter} · ${t("manual")}`}
          onClose={() => setMethod(null)}
        >
          <form onSubmit={submit}>
            <p className="muted small">{t("unknownHint")}</p>
            {image && <Notice>{t("imageNotice")}</Notice>}
            <div className="form-grid">
              {field("name", t("name"))}
              {field("formula", t("formula"))}
              {field("cas", t("cas"))}
              {field("concentration", t("concentration"), true)}
              <label className="field">
                <span>{t("unit")}</span>
                <select
                  value={form.unit}
                  onChange={(e) => update("unit", e.target.value)}
                >
                  {["Unknown", "% w/w", "% v/v", "mol/L", "g/L"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                {errors.unit && (
                  <small className="field-error">{errors.unit}</small>
                )}
              </label>
              {field("solvent", t("solvent"))}
              <label className="field">
                <span>{t("state")}</span>
                <select
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                >
                  {["Unknown", "Liquid", "Solid", "Gas"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {field("temperature", t("temperature"), true)}
              {field("quantity", t("quantity"), true)}
              <label className="field">
                <span>{t("quantityUnit")}</span>
                <select
                  value={form.quantityUnit}
                  onChange={(e) => update("quantityUnit", e.target.value)}
                >
                  {["Unknown", "mL", "L", "g", "kg"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field wide">
                <span>{t("notes")}</span>
                <textarea
                  value={form.notes}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button subtle"
                onClick={() => setMethod(null)}
              >
                {t("cancel")}
              </button>
              <button className="button primary" type="submit">
                {t("confirm")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Camera({
  onClose,
  onCapture,
  onFallback,
}: {
  onClose: () => void;
  onCapture: (f: File) => void;
  onFallback: () => void;
}) {
  const t = useText();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState(() =>
    typeof navigator.mediaDevices?.getUserMedia === "function"
      ? ""
      : "Camera access is unavailable. Use image upload instead.",
  );
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access in your browser or upload an image."
              : "No camera is available or the camera is in use. Upload an image instead.",
          );
      });
    return () => {
      active = false;
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  function capture() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2000 / v.videoWidth);
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], "label-photo.jpg", {
            type: "image/jpeg",
          });
          setPreview({ file, url: URL.createObjectURL(file) });
        }
      },
      "image/jpeg",
      0.85,
    );
  }
  return (
    <Modal title={t("camera")} onClose={onClose}>
      <Notice>{t("imageNotice")}</Notice>
      {error ? (
        <Notice kind="error">{error}</Notice>
      ) : (
        <>
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            onLoadedData={() => setReady(true)}
            className={preview ? "hidden" : "camera-video"}
          />
          {preview && (
            <img
              className="camera-preview"
              src={preview.url}
              alt={t("photo")}
            />
          )}
        </>
      )}
      <div className="modal-actions">
        {preview ? (
          <>
            <button className="button subtle" onClick={() => setPreview(null)}>
              {t("retake")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                onCapture(preview.file);
              }}
            >
              {t("confirm")}
            </button>
          </>
        ) : (
          <button
            className="button primary"
            disabled={!ready || !!error}
            onClick={capture}
          >
            <Icon name="photo_camera" />
            {t("capture")}
          </button>
        )}
        <button className="button subtle" onClick={onFallback}>
          {t("upload")}
        </button>
      </div>
    </Modal>
  );
}
