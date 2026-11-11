"use client";
import { useEffect, useState } from "react";

export function AppSetup() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return offline ? <div role="status" style={{ background: "#78350f", color: "#fff", padding: "12px", textAlign: "center" }}>Sin conexión. La fila se actualizará cuando vuelva internet.</div> : null;
}
