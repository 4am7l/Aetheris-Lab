import { useState, type FormEvent } from "react";
import { Button } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading";
import { trackingTokenSchema } from "../domain";
import { getTrackingToken } from "../services/receipts";
import { useReceipts } from "../services/useReceipts";
import { useLanguage } from "../text";
import { Dashboard } from "./Dashboard";
import { FormError, LabInput, Submit } from "./Inputs";
import { field } from "./formData";
import { getCredential, labApi, rememberCredential, words } from "./client";

export default function Personal() {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const { receipts } = useReceipts();
  const client = useQueryClient();
  const [token, setToken] = useState(() => getCredential("profile"));
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const api = labApi("/api/impact", { token });
  function access(next: string) {
    const persistent = rememberCredential("profile", next);
    setNotice(next && !persistent ? t("Save the access credential so you can open the dashboard after leaving this tab.",
      "احفظ رمز الوصول لتتمكن من فتح اللوحة بعد مغادرة علامة التبويب.") : "");
    setToken(next);
    setVersion((old) => old + 1);
    setConfirm(false);
  }
  const create = useMutation({ mutationFn: () => api<{ token: string }>("/profile/create", {}), onSuccess: (value) => access(value.token), gcTime: 0 });
  const link = useMutation({
    mutationFn: () => api("/profile/link", { id: selected, receipt: getTrackingToken(selected) }),
    onSuccess: () => {
      setNotice(t("Receipt linked.", "تم ربط الإيصال."));
      void client.invalidateQueries({ queryKey: ["impact-overview"] });
    },
  });
  const revoke = useMutation({ mutationFn: () => api("/profile/revoke", {}), onSuccess: () => access("") });
  function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = trackingTokenSchema.safeParse(field(new FormData(event.currentTarget), "token"));
    if (credential.success) access(credential.data);
    else setNotice(t("Enter a valid access credential.", "أدخل رمز وصول صالحاً."));
  }
  return <div className="page">
    <PageHeading title={t("Personal impact", "الأثر الشخصي")} />
    <section className="panel impact-panel">
      {!token ? <>
        <p>{t("Create an optional anonymous dashboard or open an existing one with your access credential.",
          "أنشئ لوحة شخصية مجهولة اختيارية أو افتح لوحة موجودة باستخدام رمز الوصول.")}</p>
        <div><Button variant="contained" disabled={create.isPending} onClick={() => create.mutate()}>{t("Create private dashboard", "إنشاء لوحة خاصة")}</Button></div>
        <form className="impact-form" onSubmit={restore}>
          <LabInput name="token" en="Existing access credential" ar="رمز الوصول الحالي" type="password" required />
          <Submit>{t("Open dashboard", "فتح اللوحة")}</Submit>
        </form>
      </> : <>
        <details className="impact-details"><summary>{t("Access credential", "رمز الوصول")}</summary>
          <p>{t("Anyone with this credential can see your linked dashboard. Keep it private.", "يمكن لحامل هذا الرمز رؤية اللوحة المرتبطة. احفظه بشكل خاص.")}</p>
          <output className="impact-wrap"><bdi>{token}</bdi></output>
        </details>
        <label htmlFor="personal-receipt">{t("Link a receipt saved in this browser", "ربط إيصال محفوظ في هذا المتصفح")}</label>
        <select id="personal-receipt" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{t("Choose a receipt", "اختر إيصالاً")}</option>
          {receipts.map(({ id, createdAt }) => <option key={id} value={id}>{createdAt.slice(0, 10)} · {id.slice(0, 8)}</option>)}
        </select>
        {receipts.length === 0 && <Link to="/requests">{t("View assessment receipts", "عرض إيصالات التقييم")}</Link>}
        <div className="button-row">
          <Button variant="contained" disabled={!selected || link.isPending} onClick={() => link.mutate()}>{t("Link receipt", "ربط الإيصال")}</Button>
          <Button onClick={() => access("")}>{t("Close dashboard on this browser", "إغلاق اللوحة على هذا المتصفح")}</Button>
          <Button color="error" onClick={() => setConfirm(!confirm)}>{t("Revoke access", "إلغاء الوصول")}</Button>
        </div>
        {confirm && <div role="group">
          <p>{t("Revoking this credential removes dashboard links. Your individual receipts remain available.", "يؤدي إلغاء هذا الرمز إلى إزالة روابط اللوحة. تظل إيصالاتك متاحة.")}</p>
          <Button color="error" variant="contained" disabled={revoke.isPending} onClick={() => revoke.mutate()}>{t("Confirm revocation", "تأكيد الإلغاء")}</Button>
        </div>}
      </>}
      {notice && <p role="status">{notice}</p>}
      <FormError error={create.error || link.error || revoke.error} />
    </section>
    {token && <Dashboard key={version} api={api} contextKey={"personal-" + version} personal />}
  </div>;
}
