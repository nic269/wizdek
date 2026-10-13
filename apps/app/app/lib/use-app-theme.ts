"use client";

import { useEffect, useState } from "react";

/** Follows the app's light or dark mode, which is a class on the root element. */
export const useAppTheme = (): "light" | "dark" => {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() =>
      setIsDark(root.classList.contains("dark"))
    );
    observer.observe(root, { attributeFilter: ["class"], attributes: true });
    return () => observer.disconnect();
  }, []);
  return isDark ? "dark" : "light";
};
