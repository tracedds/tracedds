"use client";

import { useState } from "react";
import styles from "./styleguide.module.css";
import { BrandMark, Icon } from "./icons";
import { ListStatusPill, QtyStepper } from "./ui";

// Live reference for the TraceDDS design system. Public route (/styleguide) so
// any teammate can open it without a customer account; it renders no customer
// data. The written source of truth is DESIGN.md at the repo root — this page
// is its visual mirror. Everything here is built against the canonical tokens,
// so the page itself is an example of how a new screen should be authored.

const COLOR_TOKENS = [
  { name: "--bg", hex: "#f8faff", use: "App background" },
  { name: "--surface", hex: "#ffffff", use: "Cards, panels" },
  { name: "--surface-2", hex: "#f4f7ff", use: "Insets, hovers" },
  { name: "--ink", hex: "#0b1533", use: "Primary text" },
  { name: "--muted", hex: "#67728a", use: "Secondary text" },
  { name: "--line", hex: "#e4e9f2", use: "Borders, dividers" },
  { name: "--blue", hex: "#155dfc", use: "Primary action, links" },
  { name: "--blue-2", hex: "#eef4ff", use: "Blue tint / focus ring" },
  { name: "--green", hex: "#0a9861", use: "Success, savings, in-stock" },
  { name: "--gold", hex: "#d88718", use: "Warning, in-progress" },
  { name: "--red", hex: "#ef4444", use: "Danger, destructive" },
];

const TYPE_SCALE = [
  { px: 30, weight: 900, label: "Display / page hero" },
  { px: 24, weight: 800, label: "Page title (h1)" },
  { px: 18, weight: 800, label: "Section title (h2)" },
  { px: 15, weight: 700, label: "Card title / emphasis" },
  { px: 14, weight: 600, label: "Body (base)" },
  { px: 13, weight: 600, label: "Secondary / dense rows" },
  { px: 12, weight: 700, label: "Labels, pills, captions" },
  { px: 11, weight: 700, label: "Micro / eyebrow (uppercase)" },
];

const WEIGHTS = [
  { w: 600, label: "600 Body" },
  { w: 700, label: "700 Strong" },
  { w: 800, label: "800 Title" },
  { w: 900, label: "900 Stat" },
];

const RADII = [
  { px: 8, label: "8 — inputs, chips" },
  { px: 10, label: "10 — small cards" },
  { px: 12, label: "12 — cards" },
  { px: 14, label: "14 — panels" },
  { px: 999, label: "999 — pills, buttons" },
];

const SPACING = [4, 6, 8, 12, 16, 24, 30];

const ICONS = [
  "icon-home", "icon-scan", "icon-store", "icon-package", "icon-map-pin",
  "icon-clipboard-check", "icon-shield-check", "icon-dollar-circle", "icon-truck",
  "icon-clock", "icon-bell", "icon-search", "icon-settings", "icon-users",
  "icon-check-circle", "icon-alert-triangle", "icon-x-circle", "icon-plus",
  "icon-trash", "icon-edit", "icon-arrow-right", "icon-microscope", "icon-cabinet",
  "icon-handshake",
];

const JSX_COMPONENTS = [
  ["ListStatusPill", "list status chip (draft → handed off)"],
  ["QtyStepper", "− / value / + quantity control"],
  ["UomSelect", "unit-of-measure dropdown"],
  ["ProductThumb", "product image with fallback"],
  ["MatchSupplier / CandidateName", "supplier + match candidate rows"],
  ["BuyingPreferencesCard", "editable buying-preferences panel"],
  ["ConfirmModal", "confirm / destructive dialog"],
  ["ScanResultCard", "barcode scan result"],
  ["CatalogSupplierAvatar", "supplier logo / initials badge"],
  ["Icon / BrandMark", "sprite icon + wordmark"],
];

function Swatch({ token }) {
  return (
    <div className={styles.swatch}>
      <div className={styles.swatchChip} style={{ background: `var(${token.name})` }} />
      <div className={styles.swatchMeta}>
        <div className={styles.swatchName}>{token.name}</div>
        <div className={styles.swatchHex}>{token.hex} · {token.use}</div>
      </div>
    </div>
  );
}

export default function StyleGuide() {
  const [qty, setQty] = useState(2);

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <BrandMark />
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 900 }}>Design System</h1>
      <p className={styles.lede}>
        The visual language of TraceDDS, in one place. Build new screens from these
        tokens, scales, and components so every view feels like the same product.
        This page is the live mirror of <strong>DESIGN.md</strong> — if they ever
        disagree, the code wins and the doc gets fixed.
      </p>
      <a className={styles.docLink} href="https://github.com/search?q=repo-DESIGN.md" onClick={(e) => e.preventDefault()}>
        <Icon name="icon-book" className="nav-icon" /> Full reference: DESIGN.md (repo root)
      </a>

      {/* Color */}
      <section className={styles.section}>
        <h2>Color tokens</h2>
        <p className={styles.sectionNote}>
          Defined once in <code>:root</code> (styles.css). Always reference the token,
          never the raw hex — that is what keeps screens in sync. Green is the only
          color currently consistent everywhere; the rest have drifted.
        </p>
        <div className={styles.swatchGrid}>
          {COLOR_TOKENS.map((t) => <Swatch key={t.name} token={t} />)}
        </div>
      </section>

      {/* Drift */}
      <section className={styles.section}>
        <h2>Known drift — fix on touch</h2>
        <div className={styles.callout}>
          <div className={styles.calloutTitle}>
            <Icon name="icon-alert-triangle" className="nav-icon" /> Three blues are
            in the codebase. Only one is canonical.
          </div>
          <div className={styles.calloutBody}>
            The Phase 2 module CSS (locations, scan sessions, dashboard) hardcodes
            <code> #2f5bd6</code>; parts of styles.css use <code>#0f62ff</code>. Both
            should be <code>var(--blue)</code>. Same story for <code>--ink</code> and
            <code> --red</code>. When you edit one of those files, repoint it to the
            token rather than adding a fourth shade.
          </div>
          <div className={styles.driftRow}>
            <span className={styles.driftItem}><span className={styles.driftDot} style={{ background: "#2f5bd6" }} />#2f5bd6 modules</span>
            <span className={styles.driftItem}><span className={styles.driftDot} style={{ background: "#0f62ff" }} />#0f62ff styles.css</span>
            <span className={`${styles.driftItem} ${styles.good}`}><span className={styles.driftDot} style={{ background: "var(--blue)" }} />var(--blue) ✓ canonical</span>
          </div>
        </div>
      </section>

      {/* Type */}
      <section className={styles.section}>
        <h2>Typography</h2>
        <p className={styles.sectionNote}>
          Inter, with a system fallback. Base body is 14px. Sizes cluster at
          11/12/13/14 for UI and 18/24/30 for headings — stay on the scale.
        </p>
        {TYPE_SCALE.map((t) => (
          <div className={styles.typeRow} key={t.px}>
            <span className={styles.typeSpec}>{t.px}px · {t.weight}</span>
            <span style={{ fontSize: t.px, fontWeight: t.weight, lineHeight: 1.1 }}>
              {t.label}
            </span>
          </div>
        ))}
        <div className={styles.weightRow}>
          {WEIGHTS.map((x) => (
            <div className={styles.weightItem} key={x.w}>
              <div className={styles.sample} style={{ fontWeight: x.w }}>Trace</div>
              <div className={styles.label}>{x.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Radius */}
      <section className={styles.section}>
        <h2>Radius</h2>
        <p className={styles.sectionNote}>Pills and buttons are fully rounded (999px). Cards and panels use 10–14px.</p>
        <div className={styles.scaleRow}>
          {RADII.map((r) => (
            <div className={styles.radiusItem} key={r.px}>
              <div className={styles.radiusBox} style={{ borderRadius: r.px }} />
              {r.label}
            </div>
          ))}
        </div>
      </section>

      {/* Spacing */}
      <section className={styles.section}>
        <h2>Spacing</h2>
        <p className={styles.sectionNote}>Gaps and padding step through 4 · 6 · 8 · 12 · 16 · 24 · 30. The sidebar is 280px; the sticky header is 80px tall.</p>
        <div className={styles.scaleRow}>
          {SPACING.map((s) => (
            <div className={styles.spaceItem} key={s}>
              <div className={styles.spaceBar} style={{ width: s * 4 }} />
              {s}px
            </div>
          ))}
        </div>
      </section>

      {/* Components */}
      <section className={styles.section}>
        <h2>Buttons</h2>
        <p className={styles.sectionNote}>
          Pill-shaped. Primary = solid blue. Secondary = ghost (surface + line).
          Destructive = red text on surface. There is no shared button class yet —
          the canonical pattern lives here and in DESIGN.md.
        </p>
        <div className={styles.demoRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`}>
            <Icon name="icon-plus" className="nav-icon" /> Primary action
          </button>
          <button className={`${styles.btn} ${styles.btnGhost}`}>Secondary</button>
          <button className={`${styles.btn} ${styles.btnDanger}`}>
            <Icon name="icon-trash" className="nav-icon" /> Delete
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Status pills</h2>
        <p className={styles.sectionNote}>Reorder-list lifecycle. Rendered live from the shared <code>ListStatusPill</code> component.</p>
        <div className={styles.demoRow}>
          {["draft", "review", "ordering", "ordered", "handoff"].map((s) => (
            <ListStatusPill key={s} status={s} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Inputs</h2>
        <div className={styles.demoRow}>
          <input className={styles.input} placeholder="Search products, suppliers…" />
          <QtyStepper qty={qty} setQty={setQty} />
        </div>
      </section>

      <section className={styles.section}>
        <h2>Card</h2>
        <p className={styles.sectionNote}>Surface + 1px line + soft shadow (<code>var(--shadow)</code>). The default container for almost everything.</p>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Operatory 2</div>
          <div className={styles.cardMeta}>Cabinet · 3 scan sessions</div>
          <div className={styles.cardStat} style={{ color: "var(--green)" }}>98% audit-ready</div>
        </div>
      </section>

      {/* Icons */}
      <section className={styles.section}>
        <h2>Icons</h2>
        <p className={styles.sectionNote}>
          One SVG sprite (icons.jsx). Use <code>{`<Icon name="icon-…" />`}</code> —
          they inherit <code>currentColor</code>. A representative set:
        </p>
        <div className={styles.iconGrid}>
          {ICONS.map((name) => (
            <div className={styles.iconCell} key={name}>
              <Icon name={name} className="nav-icon" />
              <span>{name.replace("icon-", "")}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Component library */}
      <section className={styles.section}>
        <h2>Shared components</h2>
        <p className={styles.sectionNote}>
          Reach for these (app/ui.jsx, app/icons.jsx) before building from scratch.
          Reusing them is what keeps screens consistent.
        </p>
        <div className={styles.componentList}>
          {JSX_COMPONENTS.map(([name, desc]) => (
            <div key={name}><code>{name}</code> — {desc}</div>
          ))}
        </div>
      </section>
    </main>
  );
}
