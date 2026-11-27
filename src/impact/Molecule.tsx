import { useEffect, useRef, useState } from "react";
import { Button } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { mat4, vec3 } from "gl-matrix";
import { useLanguage } from "../text";
import { FormError } from "./Inputs";
import { words, type LabApi } from "./client";
import type { MolecularModel } from "./science";

const colors: Record<string, string> = { C: "#647169", H: "#c7c9c2", O: "#cf594c", N: "#497ccc", S: "#b58422", P: "#bb733d", Cl: "#4d9554", F: "#4e9860" };
const resetView = { x: 0, y: 0, zoom: 1 };

export default function Molecule({ cid, api, scope }: { cid: number; api: LabApi; scope: string }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [dimension, setDimension] = useState<"2d" | "3d">("2d");
  const [view, setView] = useState(resetView);
  const [selection, setSelection] = useState<number>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const pick = useRef<{ x: number; y: number; index: number; radius: number }[]>([]);
  const pointer = useRef<{ x: number; y: number; distance: number }>(null);
  const query = useQuery({
    queryKey: ["lab-molecule", scope, cid, dimension], retry: false, gcTime: 60_000,
    queryFn: ({ signal }) => api<MolecularModel>("/knowledge/" + cid + "/" + dimension, undefined, signal),
  });
  const model = query.data;
  const chosen = selection === undefined ? undefined : model?.atoms[selection];
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || !model) return;
    const bound = surface.getContext("2d");
    if (!bound) return;
    const ctx = bound;
    const center = vec3.fromValues(
      model.atoms.reduce((sum, atom) => sum + atom.x, 0) / model.atoms.length,
      model.atoms.reduce((sum, atom) => sum + atom.y, 0) / model.atoms.length,
      model.atoms.reduce((sum, atom) => sum + atom.z, 0) / model.atoms.length,
    );
    const rotation = mat4.create();
    mat4.rotateX(rotation, rotation, view.x);
    mat4.rotateY(rotation, rotation, view.y);
    const data = model.atoms.map((atom) => {
      const vector = vec3.subtract(vec3.create(), vec3.fromValues(atom.x, atom.y, atom.z), center);
      return dimension === "3d" ? vec3.transformMat4(vector, vector, rotation) : vector;
    });
    const span = Math.max(0.5, ...data.map((vector) => vec3.length(vector)));
    const draw = () => {
      const { width, height } = surface.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      surface.width = Math.round(width * ratio);
      surface.height = Math.round(height * ratio);
      ctx.scale(ratio, ratio);
      const scale = Math.min(width, height) * 0.4 * view.zoom / span;
      const coordinates = data.map(([x, y, z], index) => ({
        x: width / 2 + x * scale, y: height / 2 - y * scale, z, index, radius: model.atoms[index].element === "H" ? 10 : 14,
      }));
      const ink = getComputedStyle(surface).color;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      for (const { from, to, order } of model.bonds) {
        const a = coordinates[from], b = coordinates[to];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const n = order === 4 ? 2 : order;
        for (let i = 0; i < n; i++) {
          const shift = (i - (n - 1) / 2) * 4;
          const dx = (b.y - a.y) * shift / length, dy = (a.x - b.x) * shift / length;
          ctx.setLineDash(order === 4 && i === 1 ? [4, 4] : []);
          ctx.beginPath(); ctx.moveTo(a.x + dx, a.y + dy); ctx.lineTo(b.x + dx, b.y + dy); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 11px system-ui";
      const front = [...coordinates].sort((a, b) => a.z - b.z);
      for (const { x, y, index, radius } of front) {
        const { element } = model.atoms[index];
        ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = colors[element] ?? "#78748f"; ctx.fill();
        if (selection === index) { ctx.lineWidth = 3; ctx.stroke(); }
        ctx.fillStyle = element === "H" ? "#151515" : "#ffffff";
        ctx.fillText(element, x, y);
      }
      pick.current = front.reverse();
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(surface);
    return () => resize.disconnect();
  }, [model, view, dimension, selection]);

  const adjustZoom = (factor: number) => setView((previous) => ({ ...previous, zoom: Math.max(0.5, Math.min(4, previous.zoom * factor)) }));
  const controls = [
    ["2d", t("2D structure", "بنية ثنائية الأبعاد")], ["3d", t("3D structure", "بنية ثلاثية الأبعاد")],
  ] as const;
  return <section className="impact-form">
    <div className="button-row">
      {controls.map(([value, name]) => <Button key={value} variant={dimension === value ? "contained" : "outlined"}
        aria-pressed={dimension === value} onClick={() => { setDimension(value); setView(resetView); setSelection(undefined); }}>{name}</Button>)}
    </div>
    {query.isPending && <p role="status">{t("Retrieving structural coordinates…", "جارٍ جلب الإحداثيات البنيوية…")}</p>}
    <FormError error={query.error} />
    {model && <>
      <canvas ref={canvas} className="impact-model" role="img" aria-label={t("Projection of PubChem molecular coordinates", "إسقاط إحداثيات الجزيء من PubChem")}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = { x: event.clientX, y: event.clientY, distance: 0 };
        }}
        onPointerMove={(event) => {
          const point = pointer.current;
          if (!point || dimension === "2d") return;
          const x = event.clientX - point.x, y = event.clientY - point.y;
          pointer.current = { x: event.clientX, y: event.clientY, distance: point.distance + Math.hypot(x, y) };
          setView((current) => ({ ...current, x: current.x + y * 0.012, y: current.y + x * 0.012 }));
        }}
        onPointerUp={(event) => {
          if (pointer.current && pointer.current.distance < 4) {
            const rect = event.currentTarget.getBoundingClientRect();
            setSelection(pick.current.find(({ x, y, radius }) => Math.hypot(x - (event.clientX - rect.left), y - (event.clientY - rect.top)) <= radius)?.index);
          }
          pointer.current = null;
        }} onPointerCancel={() => { pointer.current = null; }} />
      <div className="button-row">
        <Button onClick={() => adjustZoom(1.2)}>{t("Zoom in", "تكبير")}</Button>
        <Button onClick={() => adjustZoom(1 / 1.2)}>{t("Zoom out", "تصغير")}</Button>
        {dimension === "3d" && <>
          <Button onClick={() => setView((current) => ({ ...current, y: current.y + 0.4 }))}>{t("Rotate horizontally", "تدوير أفقياً")}</Button>
          <Button onClick={() => setView((current) => ({ ...current, x: current.x + 0.4 }))}>{t("Rotate vertically", "تدوير عمودياً")}</Button>
        </>}
        <Button onClick={() => { setView(resetView); setSelection(undefined); }}>{t("Reset view", "إعادة العرض")}</Button>
      </div>
      <label htmlFor="molecule-atom">{t("Inspect atom", "فحص ذرة")}</label>
      <select id="molecule-atom" value={selection ?? ""} onChange={(event) => setSelection(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">{t("Choose an atom", "اختر ذرة")}</option>
        {model.atoms.map(({ element }, i) => <option value={i} key={i}>{i + 1} · {element}</option>)}
      </select>
      {chosen && <output aria-live="polite"><bdi dir="ltr">{chosen.element} · x {chosen.x} · y {chosen.y}{dimension === "3d" && " · z " + chosen.z}</bdi></output>}
      <a href={model.source} target="_blank" rel="noreferrer">{t("PubChem source coordinates (SDF)", "إحداثيات PubChem المصدرية (SDF)")}</a>
    </>}
  </section>;
}
