import React, { useEffect, useRef, useState } from 'react';

export interface ExportMenuItem {
  label: string;
  onClick: (evt: React.MouseEvent) => void;
}

// Minimal dropdown used by the toolbar Export All button and the detail-view export controls.
export function ExportMenu({ label, items, disabled = false, title, buttonClassName }: {
  label: string;
  items: ExportMenuItem[];
  disabled?: boolean;
  title?: string;
  buttonClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        className={buttonClassName}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(o => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 min-w-max rounded border shadow-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
          {items.map(item => (
            <button
              key={item.label}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
              onClick={evt => {
                setOpen(false);
                item.onClick(evt);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
