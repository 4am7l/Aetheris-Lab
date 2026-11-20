import { useEffect, useRef, type ReactNode } from "react";
import { useText } from "./text";
export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${className}`}
    >
      {name}
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const t = useText();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <header>
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "warning" | "error";
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : undefined}
    >
      <Icon
        name={
          kind === "error"
            ? "error"
            : kind === "warning"
              ? "verified_user"
              : "info"
        }
      />
      <div>{children}</div>
    </div>
  );
}
export function Molecule() {
  return (
    <svg
      className="molecule"
      viewBox="0 0 430 320"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="orb">
          <stop stopColor="#fff" />
          <stop offset=".24" stopColor="#c3e4ff" />
          <stop offset="1" stopColor="#7599ec" />
        </radialGradient>
        <radialGradient id="orb2">
          <stop stopColor="#fff" />
          <stop offset=".25" stopColor="#e3dfff" />
          <stop offset="1" stopColor="#9889d5" />
        </radialGradient>
      </defs>
      <g stroke="#bacce6" strokeWidth="9" strokeLinecap="round">
        <path d="M90 195 168 140 261 182 337 111M168 140 156 57M261 182 280 267M337 111 387 170" />
      </g>
      <g stroke="#f7fbff" strokeWidth="2" opacity=".7">
        <path d="M90 191 168 136 261 178 337 107M168 136 156 53M261 178 280 263" />
      </g>
      <circle cx="90" cy="195" r="28" fill="url(#orb2)" />
      <circle cx="168" cy="140" r="41" fill="url(#orb)" />
      <circle cx="156" cy="57" r="19" fill="url(#orb2)" />
      <circle cx="261" cy="182" r="35" fill="url(#orb2)" />
      <circle cx="337" cy="111" r="29" fill="url(#orb)" />
      <circle cx="280" cy="267" r="21" fill="url(#orb)" />
      <circle cx="387" cy="170" r="17" fill="url(#orb2)" />
      <g stroke="#a8b4d0" opacity=".4">
        <ellipse
          cx="220"
          cy="160"
          rx="187"
          ry="105"
          transform="rotate(-24 220 160)"
          strokeDasharray="3 7"
        />
      </g>
      <circle cx="45" cy="98" r="4" fill="#92b0d9" />
      <circle cx="362" cy="238" r="4" fill="#92b0d9" />
    </svg>
  );
}
