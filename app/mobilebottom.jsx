"use client";

import { Icon } from "./icons";
import s from "./mobilebottom.module.css";

// Mobile bottom navigation bar — always visible on ≤767px.
// Five tabs: Today · Locations · Scan (center FAB) · Reorder · More
// activeTab: "today" | "locations" | "scan" | "reorder" | "more"

export function MobileBottomNav({ activeTab, onTab, needsAttentionCount = 0 }) {
  return (
    <nav className={s.nav} aria-label="Main navigation">
      <button
        type="button"
        className={`${s.tab} ${activeTab === "today" ? s.tabActive : ""}`}
        onClick={() => onTab("today")}
        aria-label="Today"
      >
        <Icon name="icon-home" className={s.tabIcon} />
        <span className={s.tabLabel}>Today</span>
        {needsAttentionCount > 0 && (
          <span className={s.badge}>{needsAttentionCount > 9 ? "9+" : needsAttentionCount}</span>
        )}
      </button>

      <button
        type="button"
        className={`${s.tab} ${activeTab === "locations" ? s.tabActive : ""}`}
        onClick={() => onTab("locations")}
        aria-label="Locations"
      >
        <Icon name="icon-map-pin" className={s.tabIcon} />
        <span className={s.tabLabel}>Locations</span>
      </button>

      {/* Center FAB — Scan */}
      <button
        type="button"
        className={s.fab}
        onClick={() => onTab("scan")}
        aria-label="Scan"
      >
        <Icon name="icon-scan" className={s.fabIcon} />
      </button>

      <button
        type="button"
        className={`${s.tab} ${activeTab === "reorder" ? s.tabActive : ""}`}
        onClick={() => onTab("reorder")}
        aria-label="Reorder"
      >
        <Icon name="icon-cart" className={s.tabIcon} />
        <span className={s.tabLabel}>Reorder</span>
      </button>

      <button
        type="button"
        className={`${s.tab} ${activeTab === "more" ? s.tabActive : ""}`}
        onClick={() => onTab("more")}
        aria-label="More"
      >
        <Icon name="icon-grid" className={s.tabIcon} />
        <span className={s.tabLabel}>More</span>
      </button>
    </nav>
  );
}

// "More" bottom sheet — secondary destinations off the main nav
export function MobileMoreSheet({ onNavigate, onClose }) {
  const items = [
    { icon: "icon-shield-check", label: "Evidence & compliance", view: "evidence" },
    { icon: "icon-dollar-circle", label: "Savings",              view: "savings" },
    { icon: "icon-clock",        label: "History",               view: "history" },
    { icon: "icon-store",        label: "Catalog",               view: "catalog" },
    { icon: "icon-settings",     label: "Settings",              view: "settings" },
  ];
  return (
    <div className={s.moreBackdrop} onClick={onClose}>
      <div className={s.moreSheet} onClick={(e) => e.stopPropagation()}>
        <div className={s.moreDrag} />
        <div className={s.moreTitle}>More</div>
        <div className={s.moreList}>
          {items.map(({ icon, label, view }) => (
            <button
              key={view}
              type="button"
              className={s.moreRow}
              onClick={() => { onNavigate(view); onClose(); }}
            >
              <span className={s.moreIcon}><Icon name={icon} /></span>
              <span className={s.moreLabel}>{label}</span>
              <Icon name="icon-chevron-right" className={s.moreChevron} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
