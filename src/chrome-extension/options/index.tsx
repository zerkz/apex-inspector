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
      <div className="flex flex-col md:flex-row md:items-start md:justify-center gap-8 mb-6">
        {/* Settings Card */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm max-w-md w-full">
          <div className="grid grid-cols-1 gap-6">
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-sm mb-1">Theme:</label>
              <button
                className={`px-3 py-2 rounded-lg text-sm border font-medium transition-colors duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${theme === 'dark' ? 'bg-gray-800 text-white border-gray-600 hover:bg-gray-700' : 'bg-white text-gray-900 border-gray-300 hover:bg-gray-100'}`}
                onClick={() => saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-sm mb-1">JSON View Theme:</label>
              <select
                className="px-3 py-2 rounded-lg text-sm border font-medium dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-white text-gray-900 border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={jsonViewTheme}
                onChange={e => saveSettings({ jsonViewTheme: e.target.value as JsonTheme })}
                style={{ minWidth: 120 }}
              >
                {jsonThemes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-sm mb-1">Min Height for Raw Data (px):</label>
              <input
                type="number"
                min={100}
                max={2000}
                step={10}
                className="px-3 py-2 rounded-lg text-sm border font-medium dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 bg-white text-gray-900 border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-full"
                value={minRawDataHeight}
                onChange={e => saveSettings({ minRawDataHeight: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
        {/* About Card */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm max-w-md w-full flex flex-col justify-between">
          <h2 className="text-xl font-bold mb-4">About</h2>
          <div className="text-base text-gray-700 dark:text-gray-200 mb-2">Made with <span className="text-red-500">❤️</span> by <a href="https://www.zdware.com" target="_blank" className="underline hover:text-blue-600">ZDWare</a></div>
          <div className="flex flex-col space-y-2">
            <a href="https://github.com/zerkz/apex-inspector" target="_blank" className="underline hover:text-blue-600 text-base text-gray-700 dark:text-gray-200">Project Homepage</a>
            <a href="https://github.com/zerkz/apex-inspector/issues" target="_blank" className="underline hover:text-blue-600 text-base text-gray-700 dark:text-gray-200">Report an Issue</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Options;
