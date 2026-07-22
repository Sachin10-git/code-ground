import { useState } from "react";
import api from "../utils/api";

export default function InviteModal({
  open,
  onClose,
  documentId,
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function invite() {
    if (!email.trim()) return;

    setLoading(true);

    try {
      await api.post("/invitations", {
        documentId,
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: 350,
          background: "#111",
          padding: 25,
          borderRadius: 10,
        }}
      >
        <h3>Invite Collaborator</h3>

        <input
          style={{
            width: "100%",
            padding: 10,
            marginTop: 15,
            marginBottom: 15,
          }}
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button onClick={invite} disabled={loading}>
          {loading ? "Sending..." : "Invite"}
        </button>

        <button
          onClick={onClose}
          style={{
            marginLeft: 10,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}