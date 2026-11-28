import { useState, type ReactNode } from "react";
import { Card, CardContent, Chip } from "@mui/material";
import { useLanguage } from "../text";
import type { AssessmentImpactValues } from "./contracts";
import { numberLabel } from "./labels";
import { words } from "./locale";

import { impactGroups } from "./statisticsMetrics";

export function MetricCards({ items }: { items: { title: string; value: ReactNode; detail?: string }[] }) {
  return <div className="impact-metrics">{items.map(({ title, value, detail }) => <Card variant="outlined" key={title}>
    <CardContent><span className="muted">{title}</span><strong className="impact-value"><bdi>{value}</bdi></strong>
      {detail && <small>{detail}</small>}</CardContent>
  </Card>)}</div>;
}

export function ImpactValues({ values, coverage }: {
  values: AssessmentImpactValues; coverage?: Record<keyof AssessmentImpactValues, number>;
}) {
  const lang = useLanguage();
  return <div className="impact-statistics">{impactGroups.map((group) => <section className="impact-stat-group" key={group.id}>
    <h3><Chip size="small" className={"impact-stat-" + group.id} label={words(lang, group.en, group.ar)} /></h3>
    <MetricCards items={group.metrics.map(({ key, en, ar, unit }) => ({
      title: words(lang, en, ar), value: numberLabel(lang, values[key], unit),
      detail: coverage && words(lang, "Assessments with data", "التقييمات ذات البيانات") + " · " + coverage[key],
    }))} />
  </section>)}</div>;
}

type Point = { label: string; number: number };
export function Chart({ title, points, unit }: { title: string; points: Point[]; unit?: string }) {
  const lang = useLanguage();
  const [period, setPeriod] = useState<string | null>(null);
  const selected = points.find((point) => point.label === period);
  const max = Math.max(0, ...points.map(({ number }) => Math.abs(number)));
  return <section className="impact-details">
    <h4>{title}</h4>
    {points.length ? <>
      <div className="impact-bars" aria-label={title}>
        {points.map(({ label, number }) => <button type="button" className="impact-bar" aria-pressed={period === label}
          key={label} onClick={() => setPeriod(label)}>
          <bdi>{label}</bdi> · <bdi>{numberLabel(lang, number, unit)}</bdi>
          <span aria-hidden="true" className={"impact-bar-amount" + (number < 0 ? " negative" : "")}
            style={{ inlineSize: (max ? Math.abs(number) / max * 100 : 0) + "%" }} />
        </button>)}
      </div>
      {selected && <p role="status"><bdi>{selected.label}</bdi> · <bdi>{numberLabel(lang, selected.number, unit)}</bdi></p>}
    </> : <p className="muted">{words(lang, "No data in this view.", "لا تتوفر بيانات في هذا العرض.")}</p>}
  </section>;
}

export function ImpactCharts({ series }: { series: (AssessmentImpactValues & { period: string })[] }) {
  const lang = useLanguage();
  return <section>
    <h3>{words(lang, "Historical trends", "الاتجاهات التاريخية")}</h3>
    {impactGroups.map((group) => {
      const available = group.metrics.map((metric) => ({
        ...metric,
        points: series.flatMap((record) => {
          const value = record[metric.key];
          return value === null ? [] : [{ label: record.period, number: value }];
        }),
      })).filter(({ points }) => points.length > 0);
      return <details key={group.id} className="impact-details" open={available.length ? true : undefined}>
        <summary>{words(lang, group.en, group.ar)}</summary>
        {available.length ? <div className="impact-grid">{available.map(({ key, en, ar, unit, points }) =>
          <Chart key={key} title={words(lang, en, ar)} unit={unit} points={points} />)}</div> :
          <p className="muted">{words(lang, "No supported comparisons for this chart.", "لا توجد مقارنات مدعومة لهذا الرسم.")}</p>}
      </details>;
    })}
  </section>;
}

export function ImpactMethod() {
  const lang = useLanguage();
  return <p className="muted">{words(lang,
    "Savings use a documented baseline and intervention. Totals keep hypothetical comparisons separate from verified outcomes. Carbon figures are modeled estimates, including those based on verified activity.",
    "تستند الوفورات إلى سيناريو مرجعي وتدخل موثّقين. تُعرض المقارنات الافتراضية بشكل مستقل عن النتائج الموثّقة. أرقام الكربون تقديرات مبنية على نماذج حتى عند استنادها إلى نشاط موثّق.")}</p>;
}
