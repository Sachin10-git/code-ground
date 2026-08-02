import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../utils/api";
import styles from "./InviteModal.module.css";

function Spinner({ size = 15 }) {
  return (
    <svg
      className={styles.spinner}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

export default function InviteModal({
  open,
  onClose,
  documentId,
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef(null);

  /* Focus the email input when the modal opens */
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => emailRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  /* Close on Escape */
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* Reset form when the modal closes */
  useEffect(() => {
    if (!open) setEmail("");
  }, [open]);

  /* Prevent body scroll while the modal is open */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  async function invite() {
    if (!email.trim()) return;

    setLoading(true);

    try {
      await api.post(`/invitations/${documentId}/invite`, {
        email,
      });

      alert("Invitation sent");

      setEmail("");
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || "Failed");
    }

    setLoading(false);
  }

  return createPortal(
    <div
      className={styles.modal_backdrop}
      onClick={onClose}
      role="presentation"
      aria-hidden="true"
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
      >
        <div className={styles.modal_header}>
          <h2 id="invite-modal-title" className={styles.modal_title}>
            Invite Collaborator
          </h2>
          <button
            className={styles.modal_close}
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); invite(); }}
          noValidate
        >
          <div className={styles.modal_field}>
            <label htmlFor="invite-email" className={styles.modal_label}>
              Email address
            </label>
            <input
              ref={emailRef}
              id="invite-email"
              type="email"
              className={styles.modal_input}
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel_btn}
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submit_btn}
              disabled={loading || !email.trim()}
            >
              {loading ? <><Spinner /> Sending…</> : "Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
