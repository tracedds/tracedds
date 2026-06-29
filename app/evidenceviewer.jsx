"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BrandLogoMark, Icon } from "./icons";
import { DOC_TYPES, EVIDENCE_MOCK } from "./evidence";
import s from "./evidenceviewer.module.css";

const LOCATION_NAME = "Hygiene Cabinet";

const STATUS_ROWS = [
  { key: "sds", label: "SDS linked", status: "verified", icon: "icon-file-text" },
  { key: "ifu", label: "IFU linked", status: "verified", icon: "icon-book" },
  { key: "expiration", label: "Expiration proof", status: "partial", icon: "icon-calendar" },
  { key: "lot", label: "Lot capture", status: "missing", icon: "icon-package" },
  { key: "audit", label: "Last shelf audit", value: "May 16, 2026", icon: "icon-calendar" },
];

const STATUS_META = {
  verified: { label: "Verified", icon: "icon-check-circle", tone: s.tOk },
  partial: { label: "Partial", icon: "icon-clock", tone: s.tWarn },
  missing: { label: "Missing", icon: "icon-x-circle", tone: s.tBad },
};

const ACTIVITY = [
  { title: "Shelf scan completed, evidence created", at: "May 16, 2026 at 9:15 AM" },
  { title: "Document uploaded, auto-detected as SDS", at: "May 16, 2026 at 9:16 AM" },
  { title: "Match reviewed, evidence linked", at: "May 16, 2026 at 9:18 AM" },
];

function fileIcon(doc) {
  if (doc.fileType === "image") return "icon-file-img";
  if (doc.format === "DOCX") return "icon-file-doc";
  if (doc.format === "XLSX") return "icon-file-xls";
  if (doc.fileType === "pdf") return "icon-file-pdf";
  return "icon-file-generic";
}

function fileFormat(doc) {
  if (doc.format && doc.format !== "—") return doc.format;
  if (doc.fileType === "image") return "JPG";
  if (doc.fileType === "pdf") return "PDF";
  return "File";
}

export function EvidenceMobileViewer({ data = EVIDENCE_MOCK, onBack }) {
  const docs = data.documents
    .filter((doc) => doc.location === LOCATION_NAME || ["doc_1", "doc_2", "doc_4", "doc_6"].includes(doc.id))
    .slice(0, 4);

  const filesRef = useRef(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const scrollToFiles = useCallback(() => {
    filesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <section className={s.screen} aria-label={`${LOCATION_NAME} evidence viewer`}>
      <header className={s.topbar}>
        <button type="button" className={s.backBtn} onClick={onBack} aria-label="Back to Evidence Library">
          <Icon name="icon-chevron-left" />
        </button>
        <div className={s.brand} aria-label="TraceDDS">
          <BrandLogoMark className={s.brandMark} />
          <span>TraceDDS</span>
        </div>
        <span className={s.topSpacer} aria-hidden="true" />
      </header>

      <main className={s.body}>
        <div className={s.hero}>
          <h1>{LOCATION_NAME} Evidence</h1>
          <p>Read-only presentation mode</p>
        </div>

        <section className={s.contextCard} aria-label="Location context">
          <div className={s.contextIcon}><Icon name="icon-cabinet" /></div>
          <div className={s.contextMain}>
            <h2>{LOCATION_NAME}</h2>
            <span className={s.kicker}>Location type</span>
            <strong>Cabinet</strong>
            <span className={s.qrPill}><Icon name="icon-scan" />Opened from QR label</span>
          </div>
          <div className={s.auditBlock}>
            <span className={s.auditIcon}><Icon name="icon-calendar" /></span>
            <span className={s.kicker}>Last shelf audit</span>
            <strong>May 16, 2026</strong>
          </div>
        </section>

        <EvidenceSection title="Evidence status">
          <div className={s.listCard}>
            {STATUS_ROWS.map((row) => (
              <div className={s.statusRow} key={row.key}>
                <span className={s.rowIcon}><Icon name={row.icon} /></span>
                <span className={s.rowLabel}>{row.label}</span>
                {row.status ? (
                  <span className={`${s.statusValue} ${STATUS_META[row.status].tone}`}>
                    <Icon name={STATUS_META[row.status].icon} />
                    {STATUS_META[row.status].label}
                  </span>
                ) : (
                  <span className={s.dateValue}>{row.value}</span>
                )}
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection title="Open files" ref={filesRef}>
          <div className={s.listCard}>
            {docs.map((doc) => {
              const meta = DOC_TYPES[doc.type];
              return (
                <article className={s.fileRow} key={doc.id} aria-label={`${doc.fileName}, ${meta.badge}`}>
                  <span className={s.fileIcon}><Icon name={fileIcon(doc)} /></span>
                  <span className={s.fileName}>{doc.fileName}</span>
                  <span className={s.fileType}>{fileFormat(doc)}</span>
                </article>
              );
            })}
          </div>
        </EvidenceSection>

        <EvidenceSection title="Evidence activity">
          <ol className={s.activityCard}>
            {ACTIVITY.map((item) => (
              <li key={item.title}>
                <span className={s.activityDot} aria-hidden="true" />
                <span className={s.activityTitle}>{item.title}</span>
                <time>{item.at}</time>
              </li>
            ))}
          </ol>
        </EvidenceSection>
      </main>

      <footer className={s.footbar}>
        <button type="button" className={s.footOutline} onClick={scrollToFiles}>
          <Icon name="icon-folder" />Open files
        </button>
        <button type="button" className={s.footPrimary} onClick={() => setSheetOpen(true)}>
          <Icon name="icon-archive-down" />Export evidence
        </button>
      </footer>

      {sheetOpen && (
        <ShareSheet locationName={LOCATION_NAME} onClose={() => setSheetOpen(false)} />
      )}
    </section>
  );
}

const ShareSheet = ({ locationName, onClose }) => {
  // Browser-capability detection runs after mount so the server render and the
  // first client render agree (both assume "not yet detected"), then we light up
  // whatever this device actually supports. Everything here is read-only — no
  // action mutates an evidence record.
  const [canShare, setCanShare] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setCanShare(typeof navigator.share === "function");
      setCanCopy(Boolean(navigator.clipboard?.writeText));
    }
    return () => clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareTitle = `${locationName} Evidence`;
  const shareText = `Read-only compliance evidence for ${locationName} (TraceDDS).`;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }, [shareUrl]);

  const share = useCallback(async () => {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      onClose();
    } catch {
      // User dismissed the native share sheet, or the call was rejected — keep
      // our sheet open so they can pick another action.
    }
  }, [shareTitle, shareText, shareUrl, onClose]);

  const print = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  return (
    <div className={s.sheetRoot} role="dialog" aria-modal="true" aria-label="Share and export evidence">
      <div className={s.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <div className={s.sheet}>
        <span className={s.sheetGrip} aria-hidden="true" />
        <div className={s.sheetHead}>
          <strong>Share &amp; export</strong>
          <button type="button" className={s.sheetClose} onClick={onClose} aria-label="Close">
            <Icon name="icon-x" />
          </button>
        </div>

        <div className={s.sheetActions}>
          <ShareAction
            icon={copied ? "icon-check" : "icon-link"}
            title={copied ? "Link copied" : "Copy link"}
            sub={canCopy ? "Read-only link to this evidence" : "Copying isn’t available in this browser"}
            done={copied}
            disabled={!canCopy}
            disabledNote="Unavailable"
            onClick={copyLink}
          />
          <ShareAction
            icon="icon-cloud-upload"
            title="Share…"
            sub={canShare ? "Send via your device’s share menu" : "Your device’s share menu isn’t available here"}
            disabled={!canShare}
            disabledNote="Not supported"
            onClick={share}
          />
          <ShareAction
            icon="icon-file-text"
            title="Print or save as PDF"
            sub="Opens the print dialog"
            onClick={print}
          />
        </div>

        <p className={s.sheetNote}>Read-only — these actions never change the evidence record.</p>
      </div>
    </div>
  );
};

function ShareAction({ icon, title, sub, onClick, disabled = false, disabledNote, done = false }) {
  return (
    <button
      type="button"
      className={`${s.sheetAction} ${done ? s.sheetActionDone : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={s.sheetActionIcon}><Icon name={icon} /></span>
      <span className={s.sheetActionText}>
        <span className={s.sheetActionTitle}>{title}</span>
        <span className={s.sheetActionSub}>{sub}</span>
      </span>
      {disabled ? (
        <span className={s.sheetActionState}>{disabledNote}</span>
      ) : (
        <span className={s.sheetActionChevron} aria-hidden="true"><Icon name="icon-chevron-right" /></span>
      )}
    </button>
  );
}

function EvidenceSection({ title, children, ref }) {
  return (
    <section className={s.section} ref={ref}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
