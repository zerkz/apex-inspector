import { useEffect, useState } from "react";

export type OptionsSettings = {
  theme: 'light' | 'dark';
  jsonViewTheme: 'default' | 'a11y' | 'github' | 'vscode' | 'atom' | 'winter-is-coming';
  minRawDataHeight?: number; // px, optional for backward compat
};

const DEFAULTS: OptionsSettings = {
  theme: 'light',
  jsonViewTheme: 'default',
  minRawDataHeight: 320,
};

export function useOptionsSettings() {
  const [settings, setSettings] = useState<OptionsSettings>(DEFAULTS);

  // Load from chrome.storage or localStorage
  useEffect(() => {
    const load = async () => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['theme', 'jsonViewTheme', 'minRawDataHeight'], (result) => {
          setSettings({
            theme: result.theme || DEFAULTS.theme,
            jsonViewTheme: result.jsonViewTheme || DEFAULTS.jsonViewTheme,
            minRawDataHeight: typeof result.minRawDataHeight === 'number' ? result.minRawDataHeight : DEFAULTS.minRawDataHeight,
          });
        });
      } else {
        // fallback to localStorage
        setSettings({
          theme: (localStorage.getItem('theme') as 'light' | 'dark') || DEFAULTS.theme,
          jsonViewTheme: (localStorage.getItem('jsonViewTheme') as OptionsSettings['jsonViewTheme']) || DEFAULTS.jsonViewTheme,
          minRawDataHeight: Number(localStorage.getItem('minRawDataHeight')) || DEFAULTS.minRawDataHeight,
        });
      }
    };
    load();
  }, []);

  // Save to chrome.storage or localStorage
  const save = (newSettings: Partial<OptionsSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(updated);
    } else {
      localStorage.setItem('theme', updated.theme);
      localStorage.setItem('jsonViewTheme', updated.jsonViewTheme);
      if (typeof updated.minRawDataHeight === 'number') {
        localStorage.setItem('minRawDataHeight', String(updated.minRawDataHeight));
      }
    }
  };

  return [settings, save] as const;
}
