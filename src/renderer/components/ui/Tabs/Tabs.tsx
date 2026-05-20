// Small, opinionated tabs primitive. Controlled by the parent — we own
// only the keyboard/aria plumbing. Designed for the right-panel split
// between "Trascrizione" and "Individuazione speaker": few tabs, each
// can be disabled, optional badge dot for "something is happening".

import React, { useRef } from 'react';
import './Tabs.css';

export interface TabDescriptor<Id extends string = string> {
  id: Id;
  label: string;
  /** Visually de-emphasises and blocks selection. */
  disabled?: boolean;
  /** Renders a small animated dot, e.g. when a background job is running. */
  busy?: boolean;
  /** Optional leading icon. */
  icon?: React.ReactNode;
}

export interface TabsProps<Id extends string = string> {
  tabs: ReadonlyArray<TabDescriptor<Id>>;
  activeId: Id;
  onChange: (id: Id) => void;
  ariaLabel: string;
}

function Tabs<Id extends string = string>({
  tabs,
  activeId,
  onChange,
  ariaLabel,
}: TabsProps<Id>): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    e.preventDefault();
    const enabled = tabs.map((t, i) => ({ t, i })).filter(({ t }) => !t.disabled);
    if (enabled.length === 0) return;
    const currentPos = enabled.findIndex((e) => e.i === index);
    let nextPos: number;
    if (e.key === 'ArrowRight') nextPos = (currentPos + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') nextPos = (currentPos - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') nextPos = 0;
    else nextPos = enabled.length - 1;
    const target = enabled[nextPos]!;
    onChange(target.t.id);
    const next = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-tab-index='${target.i}']`
    );
    next?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className="tabs" ref={listRef}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab-index={index}
            aria-selected={isActive}
            aria-disabled={tab.disabled ? true : undefined}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            className={`tabs-tab${isActive ? ' active' : ''}${tab.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (!tab.disabled) onChange(tab.id);
            }}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {tab.icon ? <span className="tabs-tab-icon">{tab.icon}</span> : null}
            <span className="tabs-tab-label">{tab.label}</span>
            {tab.busy && <span className="tabs-tab-busy" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export { Tabs };
