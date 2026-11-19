import { useEffect, useState } from "react";
import type { RuntimeSnapshot, UserSettings } from "@shared/contracts";
import { defaultSnapshot } from "@shared/defaults";

export function useRuntimeSnapshot() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(defaultSnapshot);
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    if (typeof window.safeScreen === "undefined") {
      setIsBooting(false);
      return;
    }

    let isMounted = true;

    window.safeScreen
      .getSnapshot()
      .then((next) => {
        if (!isMounted) {
          return;
        }
        setSnapshot(next);
        setIsBooting(false);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }
        setIsBooting(false);
      });

    const unsubscribe = window.safeScreen.onSnapshot((next) => {
      if (!isMounted) {
        return;
      }
      setSnapshot(next);
      setIsBooting(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const updateSettings = (next: Partial<UserSettings>) =>
    window.safeScreen.updateSettings(next);
  const chooseFaceProfileImages = (name: string) =>
    window.safeScreen.chooseFaceProfileImages(name);
  const removeFaceProfile = (id: string) =>
    window.safeScreen.removeFaceProfile(id);

  return {
    snapshot,
    isBooting,
    updateSettings,
    chooseFaceProfileImages,
    removeFaceProfile
  };
}
