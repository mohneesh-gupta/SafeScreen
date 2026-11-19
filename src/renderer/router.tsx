import { useEffect, useState } from "react";
import { BrowserFallback } from "./views/browser-fallback";
import { ControlPanel } from "./views/control-panel";
import { OverlayView } from "./views/overlay-view";

function getRoute() {
  return window.location.hash === "#/overlay" ? "overlay" : "main";
}

export function AppRouter() {
  const [route, setRoute] = useState(getRoute());
  const hasDesktopBridge = typeof window.safeScreen !== "undefined";

  useEffect(() => {
    const onHashChange = () => {
      setRoute(getRoute());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  if (!hasDesktopBridge) {
    return <BrowserFallback />;
  }

  return route === "overlay" ? <OverlayView /> : <ControlPanel />;
}
