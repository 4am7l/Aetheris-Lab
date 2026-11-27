import { Icon, Notice } from "../ui";
import { useLanguage, useText } from "../text";
import PageHeading from "../components/PageHeading";
import { words } from "../impact/locale";
export default function About() {
  const t = useText();
  const language = useLanguage();
  return (
    <div className="page about-page">
      <PageHeading
        eyebrow="AETHERIS LAB"
        title={t("aboutTitle")}
        description={t("aboutText")}
      />
      <div className="detail-grid">
        <section className="panel">
          <Icon name="verified_user" />
          <h2>{t("safety")}</h2>
          <p>{t("safetyText")}</p>
          <p>{t("approval")}</p>
        </section>
        <section className="panel">
          <Icon name="construction" />
          <h2>{t("readiness")}</h2>
          <p>{t("readinessText")}</p>
          <p>{t("localNotice")}</p>
        </section>
      </div>
      <section className="panel">
        <h2>{words(language, "Chemical emergency information", "معلومات الطوارئ الكيميائية")}</h2>
        <p>{words(language, "Contact local emergency services and laboratory safety personnel. Consult your institution's approved procedures and the product safety data sheet.",
          "اتصل بخدمات الطوارئ المحلية ومسؤولي السلامة في المختبر. راجع إجراءات مؤسستك المعتمدة وصحيفة بيانات السلامة للمنتج.")}</p>
        <a href="https://www.cdc.gov/chemical-emergencies/response/index.html" target="_blank" rel="noreferrer">
          {words(language, "CDC chemical emergency guidance (U.S.)", "إرشادات CDC للطوارئ الكيميائية (الولايات المتحدة)")}
        </a>
      </section>
      <Notice>{t("privacy")}</Notice>
    </div>
  );
}
