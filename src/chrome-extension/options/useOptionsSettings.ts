import { useEffect, useState } from "react";
import { StorageSync } from '../storageSync';

export type OptionsSettings = {
  theme: 'light' | 'dark';
  jsonViewTheme: 'default' | 'a11y' | 'github' | 'vscode' | 'atom' | 'winter-is-coming';
  minRawDataHeight?: number; // px, optional for backward compat
  apexClassMappingsJson?: string; // JSON string from SF CLI SOQL query
  alwaysExpandedJson?: boolean; // Always expand JSON views (depth limit 50)
  // Future boxcar color options (not yet implemented):
  // allowBrightColors?: boolean; // Allow bright/vibrant colors for boxcar icons
  // maxLightness?: number; // Maximum lightness percentage (default: 65)
  // minLightness?: number; // Minimum lightness percentage (default: 45)
};

const DEFAULTS: OptionsSettings = {
  theme: 'light',
  jsonViewTheme: 'default',
  minRawDataHeight: 320, 
  apexClassMappingsJson: '', 
  alwaysExpandedJson: false,
};

export function useOptionsSettings() {
  const [settings, setSettings] = useState<OptionsSettings>(DEFAULTS);

  // Load settings on mount
  useEffect(() => {
    const storageSync = StorageSync.getInstance();
    
    const loadSettings = async () => {
      try {
        const loadedSettings = await storageSync.loadSettings();
        setSettings(loadedSettings);
        console.log('Settings loaded:', loadedSettings);
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };

    loadSettings();
  }, []);

  // Listen for settings changes from other contexts
  useEffect(() => {
    const storageSync = StorageSync.getInstance();
    
    const handleSettingsChange = (newSettings: OptionsSettings) => {
      console.log('Settings updated from sync:', newSettings);
      setSettings(newSettings);
    };

    storageSync.addListener(handleSettingsChange);

    return () => {
      storageSync.removeListener(handleSettingsChange);
    };
  }, []);

  // Save settings
  const save = async (newSettings: Partial<OptionsSettings>) => {
    try {
      const storageSync = StorageSync.getInstance();
      const updated = await storageSync.saveSettings(newSettings);
      setSettings(updated);
      console.log('Settings saved and updated:', newSettings);
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  return [settings, save] as const;
}
