// Storage synchronization utility for Chrome extension
// Handles both chrome.storage and cross-context messaging for settings sync

import type { OptionsSettings } from './options/useOptionsSettings';

const STORAGE_KEYS = ['theme', 'jsonViewTheme', 'minRawDataHeight', 'apexClassMappingsJson', 'alwaysExpandedJson'];

export class StorageSync {
  private static instance: StorageSync;
  private listeners: Set<(settings: OptionsSettings) => void> = new Set();

  static getInstance(): StorageSync {
    if (!StorageSync.instance) {
      StorageSync.instance = new StorageSync();
    }
    return StorageSync.instance;
  }

  private constructor() {
    this.setupStorageListener();
    this.setupMessageListener();
  }

  private setupStorageListener() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
          const hasRelevantChanges = STORAGE_KEYS.some(key => key in changes);
          if (hasRelevantChanges) {
            console.log('Chrome storage changed:', Object.keys(changes));
            this.loadAndNotify();
          }
        }
      });
    }
  }

  private setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'SETTINGS_CHANGED') {
          console.log('Settings changed via message:', message.settings);
          this.notifyListeners(message.settings);
          sendResponse({ success: true });
        }
        return false;
      });
    }
  }

  async loadSettings(): Promise<OptionsSettings> {
    const defaults: OptionsSettings = {
      theme: 'light',
      jsonViewTheme: 'default',
      minRawDataHeight: 320,
      apexClassMappingsJson: '',
      alwaysExpandedJson: false,
    };

    // Try Chrome storage first
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return new Promise((resolve) => {
          chrome.storage.local.get(STORAGE_KEYS, (result) => {
            if (chrome.runtime.lastError) {
              console.warn('Chrome storage get error:', chrome.runtime.lastError);
              resolve(this.loadFromLocalStorage(defaults));
            } else {
              console.log('Loaded from chrome.storage:', result);
              resolve({
                theme: result.theme || defaults.theme,
                jsonViewTheme: result.jsonViewTheme || defaults.jsonViewTheme,
                minRawDataHeight: typeof result.minRawDataHeight === 'number' ? result.minRawDataHeight : defaults.minRawDataHeight,
                apexClassMappingsJson: result.apexClassMappingsJson || defaults.apexClassMappingsJson,
                alwaysExpandedJson: typeof result.alwaysExpandedJson === 'boolean' ? result.alwaysExpandedJson : defaults.alwaysExpandedJson,
              });
            }
          });
        });
      } catch (error) {
        console.warn('Chrome storage access failed:', error);
        return this.loadFromLocalStorage(defaults);
      }
    } else {
      return this.loadFromLocalStorage(defaults);
    }
  }

  private loadFromLocalStorage(defaults: OptionsSettings): OptionsSettings {
    try {
      return {
        theme: (localStorage.getItem('theme') as 'light' | 'dark') || defaults.theme,
        jsonViewTheme: (localStorage.getItem('jsonViewTheme') as OptionsSettings['jsonViewTheme']) || defaults.jsonViewTheme,
        minRawDataHeight: Number(localStorage.getItem('minRawDataHeight')) || defaults.minRawDataHeight,
        apexClassMappingsJson: localStorage.getItem('apexClassMappingsJson') || defaults.apexClassMappingsJson,
        alwaysExpandedJson: localStorage.getItem('alwaysExpandedJson') === 'true' || defaults.alwaysExpandedJson,
      };
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
      return defaults;
    }
  }

  async saveSettings(newSettings: Partial<OptionsSettings>): Promise<OptionsSettings> {
    const currentSettings = await this.loadSettings();
    const updated = { ...currentSettings, ...newSettings };

    // Try Chrome storage first
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return new Promise((resolve) => {
          chrome.storage.local.set(updated, () => {
            if (chrome.runtime.lastError) {
              console.warn('Chrome storage set error:', chrome.runtime.lastError);
              this.saveToLocalStorage(updated);
              this.broadcastSettingsChange(updated);
              resolve(updated);
            } else {
              console.log('Settings saved to chrome.storage.local:', newSettings);
              // Chrome storage will automatically sync via onChanged listener
              resolve(updated);
            }
          });
        });
      } catch (error) {
        console.warn('Chrome storage save failed:', error);
        this.saveToLocalStorage(updated);
        this.broadcastSettingsChange(updated);
        return updated;
      }
    } else {
      this.saveToLocalStorage(updated);
      this.broadcastSettingsChange(updated);
      return updated;
    }
  }

  private saveToLocalStorage(settings: OptionsSettings) {
    try {
      localStorage.setItem('theme', settings.theme);
      localStorage.setItem('jsonViewTheme', settings.jsonViewTheme);
      if (typeof settings.minRawDataHeight === 'number') {
        localStorage.setItem('minRawDataHeight', String(settings.minRawDataHeight));
      }
      if (settings.apexClassMappingsJson !== undefined) {
        localStorage.setItem('apexClassMappingsJson', settings.apexClassMappingsJson);
      }
      if (settings.alwaysExpandedJson !== undefined) {
        localStorage.setItem('alwaysExpandedJson', String(settings.alwaysExpandedJson));
      }
      console.log('Settings saved to localStorage');
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }

  private broadcastSettingsChange(settings: OptionsSettings) {
    // Use chrome.runtime.sendMessage to notify other contexts
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({
          type: 'SETTINGS_CHANGED',
          settings: settings
        }, () => {
          if (chrome.runtime.lastError) {
            // This is expected if no other contexts are listening
            console.log('No listeners for settings broadcast');
          }
        });
      } catch (error) {
        console.warn('Failed to broadcast settings change:', error);
      }
    }
  }

  private async loadAndNotify() {
    try {
      const settings = await this.loadSettings();
      this.notifyListeners(settings);
    } catch (error) {
      console.error('Failed to load and notify:', error);
    }
  }

  private notifyListeners(settings: OptionsSettings) {
    this.listeners.forEach(listener => {
      try {
        listener(settings);
      } catch (error) {
        console.error('Error in settings listener:', error);
      }
    });
  }

  addListener(listener: (settings: OptionsSettings) => void) {
    this.listeners.add(listener);
  }

  removeListener(listener: (settings: OptionsSettings) => void) {
    this.listeners.delete(listener);
  }
}
