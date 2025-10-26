import { useEffect, useState } from "react";

export function useLocalStorage(key: string, initialValue: string = "") {
  const [val, setVal] = useState<string>(() => {
    try {
      const v = localStorage.getItem(key);
      return v ?? initialValue;
    } catch { return initialValue; }
  });

  useEffect(() => {
    try {
      if (val === undefined || val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch { /* ignore */ }
  }, [key, val]);

  return [val, setVal] as const;
}
