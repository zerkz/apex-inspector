import "../global.css";
import React from "react";
import { useOptionsSettings } from "./useOptionsSettings";

const jsonThemes = [
  'default', 'a11y', 'github', 'vscode', 'atom', 'winter-is-coming'
] as const;
type JsonTheme = typeof jsonThemes[number];

const Options = () => {
  const [settings, saveSettings] = useOptionsSettings();
  const { theme, jsonViewTheme, minRawDataHeight = 320 } = settings;

  // Set <html> class for dark mode
  React.useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') html.classList.add('dark');
    else html.classList.remove('dark');
  }, [theme]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-8">
      <h1 className="text-2xl font-bold mb-6">Apex Inspector Options</h1>
      <div className="flex flex-col gap-6 max-w-md">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Theme:</span>
          <button
            className={`px-2 py-1 rounded text-xs border transition-colors duration-200 ${theme === 'dark' ? 'bg-gray-800 text-white border-gray-600 hover:bg-gray-700' : 'bg-gray-200 text-gray-900 border-gray-300 hover:bg-gray-300'}`}
            onClick={() => saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-semibold">JSON View Theme:</span>
          <select
            className="px-2 py-1 rounded text-xs border dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-gray-100 text-gray-900 border-gray-300"
            value={jsonViewTheme}
            onChange={e => saveSettings({ jsonViewTheme: e.target.value as JsonTheme })}
            style={{ minWidth: 120 }}
          >
            {jsonThemes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-semibold">Min Height for Raw Data (px):</span>
          <input
            type="number"
            min={100}
            max={2000}
            step={10}
            className="px-2 py-1 rounded text-xs border dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-gray-100 text-gray-900 border-gray-300 w-24"
            value={minRawDataHeight}
            onChange={e => saveSettings({ minRawDataHeight: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
};

export default Options;
