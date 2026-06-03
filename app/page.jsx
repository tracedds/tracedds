"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import medmkpLogo from "../logo/Blue Logo Vertical Large - MedMKP.png";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const PROCESSING_DURATION_MS = 3000;
const UPLOAD_WIZARD_STEPS = [
  { key: "upload", label: "Upload" },
  { key: "recommendation", label: "Recommendation" },
  { key: "review", label: "Review" },
  { key: "submit", label: "Submit" },
];

const suppliers = [
  { name: "Rehab Supply Co.", signal: "EIN verified · PT catalog · 97% on-time" },
  { name: "Clinical Direct", signal: "ACH ready · 2-day Southeast lanes" },
  { name: "NeuroStim Supply", signal: "Electrotherapy specialist · certificate current" },
  { name: "PrimeMed Distributors", signal: "Thomasnet sourced · glove alternatives" },
  { name: "OrthoPro Wholesale", signal: "Bulk therapy equipment · stock confirmed" },
];

const orderSteps = [
  { label: "Invoice uploaded", detail: "Buyer sent current supplier invoice" },
  { label: "Draft order", detail: "Line items normalized for reorder" },
  { label: "Buyer review", detail: "Clinic confirms quantities and substitutions" },
  { label: "PO sent", detail: "Supplier orders placed" },
  { label: "Supplier confirmed", detail: "Awaiting confirmations" },
  { label: "Shipped", detail: "Tracking pending" },
  { label: "Reorder reminder", detail: "Scheduled for 30 days" },
];

function statusClass(status) {
  if (status === "Parsed") return "success";
  if (status === "Alternative" || status === "Needs review") return "warning";
  return "info";
}

function sumSelected(lineItems) {
  return lineItems.reduce((total, item) => total + item.selected.total, 0);
}

function sumPrevious(lineItems) {
  return lineItems.reduce((total, item) => total + item.oldUnitPrice * item.qty, 0);
}

function recommendationLabel(matchType) {
  if (matchType === "exact") return "Exact match";
  if (matchType === "equivalent") return "Equivalent match";
  if (matchType === "substitute") return "Better-value substitute";
  return "Needs decision";
}

function recommendationClass(matchType) {
  if (matchType === "needs_review") return "warning";
  if (matchType === "substitute" || matchType === "equivalent") return "info";
  return "success";
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function IconSprite() {
  return (
    <svg className="icon-sprite" aria-hidden="true">
      <symbol id="icon-home" viewBox="0 0 24 24">
        <path d="M3 10.8 12 3l9 7.8v8.4a1.8 1.8 0 0 1-1.8 1.8h-4.5v-6.2H9.3V21H4.8A1.8 1.8 0 0 1 3 19.2v-8.4Z" />
      </symbol>
      <symbol id="icon-file-plus" viewBox="0 0 24 24">
        <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
        <path d="M13 3.5V9h5" />
        <path d="M9 15h5.5M11.75 12.25v5.5" />
      </symbol>
      <symbol id="icon-file-text" viewBox="0 0 24 24">
        <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
        <path d="M13 3.5V9h5" />
        <path d="M8.5 13h7M8.5 16h7" />
      </symbol>
      <symbol id="icon-clipboard" viewBox="0 0 24 24">
        <path d="M8 5.5h8" />
        <path d="M9 3.5h6l1 2h2A1.5 1.5 0 0 1 19.5 7v13A1.5 1.5 0 0 1 18 21.5H6A1.5 1.5 0 0 1 4.5 20V7A1.5 1.5 0 0 1 6 5.5h2l1-2Z" />
        <path d="M8.5 11.5h7M8.5 15.5h7" />
      </symbol>
      <symbol id="icon-package" viewBox="0 0 24 24">
        <path d="m12 3 8 4.3v9.4L12 21l-8-4.3V7.3L12 3Z" />
        <path d="m4.5 7.6 7.5 4 7.5-4M12 12v8" />
      </symbol>
      <symbol id="icon-users" viewBox="0 0 24 24">
        <path d="M9.5 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z" />
        <path d="M3.8 19.5c.7-3.2 2.8-5 5.7-5s5 1.8 5.7 5" />
        <path d="M16 11.2a2.7 2.7 0 1 0-.8-5.2M16.8 14.4c2.4.3 4 2 4.6 4.6" />
      </symbol>
      <symbol id="icon-chart" viewBox="0 0 24 24">
        <path d="M4 20.5h17" />
        <path d="M6.5 17V10M12 17V5M17.5 17v-8" />
        <path d="M5 20.5h14.5a1.5 1.5 0 0 0 1.5-1.5V4" />
      </symbol>
      <symbol id="icon-settings" viewBox="0 0 24 24">
        <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
        <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.4-2.4 1a8.6 8.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6a8.6 8.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a8.6 8.6 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8.6 8.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z" />
      </symbol>
      <symbol id="icon-search" viewBox="0 0 24 24">
        <path d="M10.8 18.1a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z" />
        <path d="m16 16 5 5" />
      </symbol>
      <symbol id="icon-cloud-upload" viewBox="0 0 24 24">
        <path d="M8 18.5H6.8a4.3 4.3 0 0 1-.8-8.5 6 6 0 0 1 11.4-1.8A4.8 4.8 0 0 1 18 18.5h-2" />
        <path d="M12 19V11" />
        <path d="m8.5 14.5 3.5-3.5 3.5 3.5" />
      </symbol>
      <symbol id="icon-store" viewBox="0 0 24 24">
        <path d="M4 10.5h16l-1.5-6h-13L4 10.5Z" />
        <path d="M5.5 10.5V20h13v-9.5" />
        <path d="M9 20v-5.5h6V20" />
        <path d="M4 10.5c.4 1.4 1.4 2.1 2.8 2.1s2.4-.7 2.8-2.1c.4 1.4 1.4 2.1 2.8 2.1s2.4-.7 2.8-2.1c.4 1.4 1.4 2.1 2.8 2.1s2.4-.7 2.8-2.1" />
      </symbol>
    </svg>
  );
}

function BrandMark() {
  return (
    <img className="brand-mark" src={medmkpLogo.src} alt="MedMKP" />
  );
}

function Icon({ name, className = "nav-icon" }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

function LoggedOutLanding({ onEnter }) {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#" aria-label="MedMKP home">
          <BrandMark />
        </a>
        <nav aria-label="Landing navigation">
          <a href="#how-it-works">How it Works</a>
          <a href="#solutions">Solutions</a>
          <button type="button" onClick={() => onEnter("supplier")}>Suppliers</button>
          <a href="#pricing">Pricing</a>
          <a href="#resources">Resources</a>
        </nav>
        <button className="primary-action compact" type="button" onClick={() => onEnter("upload")}>Get Started</button>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-pill">Concierge procurement for healthcare</span>
          <h1>Upload your invoice. Get a better reorder quote.</h1>
          <p>We analyze your current supplies, compare vetted suppliers, and build a cleaner, lower-cost reorder fast.</p>
          <div className="landing-actions">
            <button className="primary-action" type="button" onClick={() => onEnter("upload")}>
              <Icon name="icon-cloud-upload" className="button-icon" />
              Upload Invoice
            </button>
            <a className="secondary-action" href="#how-it-works">
              See How It Works
            </a>
          </div>
          <div className="landing-assurances">
            <span><Icon name="icon-settings" className="button-icon" />Secure workflow</span>
            <span><Icon name="icon-file-text" className="button-icon" />Your data is never shared</span>
            <span><Icon name="icon-store" className="button-icon" />No vendor switch required</span>
          </div>
        </div>

        <div className="landing-product" aria-label="MedMKP dashboard preview">
          <div className="preview-sidebar">
            <div className="preview-brand"><BrandMark /></div>
            {["Dashboard", "Invoices", "Quotes", "Orders", "Suppliers", "Settings"].map((item, index) => (
              <span className={index === 0 ? "active" : ""} key={item}>{item}</span>
            ))}
          </div>
          <div className="preview-main">
            <div className="preview-header">
              <div>
                <strong>Welcome back, Alex</strong>
                <span>Here is what is happening with your requests.</span>
              </div>
              <button type="button" onClick={() => onEnter("upload")}>Upload Invoice</button>
            </div>
            <div className="preview-metrics">
              <div><span>Invoices Uploaded</span><strong>7</strong><small>This month</small></div>
              <div><span>Quotes Generated</span><strong>5</strong><small>This month</small></div>
              <div><span>Avg. Potential Savings</span><strong className="positive">18%</strong><small>vs. current spend</small></div>
            </div>
            <div className="preview-quotes">
              <div className="preview-section-title"><strong>Recent Quote</strong><button type="button" onClick={() => onEnter("order")}>View all</button></div>
              <article>
                <Icon name="icon-file-text" className="button-icon" />
                <span><strong>Invoice #INV-2024-0517</strong><small>May 17, 2024 · 32 items</small></span>
                <em>$18,392.00</em>
              </article>
              <article>
                <Icon name="icon-file-text" className="button-icon" />
                <span><strong>Invoice #INV-2024-0430</strong><small>Apr 30, 2024 · 28 items</small></span>
                <em>$14,850.75</em>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="trusted-strip" id="solutions">
        <h2>Trusted by clinics and healthcare teams</h2>
        <div>
          <span>Chiropractic Clinics</span>
          <span>Physical Therapy</span>
          <span>Med Spas</span>
          <span>Senior Care</span>
          <span>And more</span>
        </div>
      </section>

      <section className="landing-steps" id="how-it-works">
        <h2>How it works</h2>
        <div>
          <article>
            <Icon name="icon-cloud-upload" className="landing-step-icon" />
            <strong>Upload Invoice</strong>
            <p>Upload any supplier invoice or reorder list. We extract and organize the line items.</p>
          </article>
          <article>
            <Icon name="icon-search" className="landing-step-icon" />
            <strong>We Compare Suppliers</strong>
            <p>We compare vetted supplier options and surface the best price, speed, and product fit.</p>
          </article>
          <article>
            <Icon name="icon-clipboard" className="landing-step-icon" />
            <strong>You Approve & Reorder</strong>
            <p>Review the recommendation, approve the order, and we handle the fulfillment workflow.</p>
          </article>
        </div>
      </section>

      <section className="landing-outcomes" id="pricing">
        <div>
          <h2>Better procurement. Better outcomes.</h2>
          <p>We help healthcare teams save time and money so they can focus on patient care.</p>
        </div>
        <article>
          <Icon name="icon-chart" className="landing-step-icon" />
          <strong>Lower Supply Spend</strong>
          <p>Save 15-30% on average through smarter sourcing and transparent pricing.</p>
        </article>
        <article>
          <Icon name="icon-package" className="landing-step-icon" />
          <strong>Fewer Stockouts</strong>
          <p>Proactive reorder reminders keep critical supplies available.</p>
        </article>
        <article id="resources">
          <Icon name="icon-settings" className="landing-step-icon" />
          <strong>Faster Reorders</strong>
          <p>Concierge support and streamlined workflows reduce repeat ordering time.</p>
        </article>
      </section>

      <footer className="landing-footer">
        <Icon name="icon-settings" className="button-icon" />
        Security-first. HIPAA-aware. Built for healthcare procurement.
      </footer>
    </main>
  );
}

export default function Home() {
  const uploadFormRef = useRef(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [view, setViewState] = useState("landing");
  const [menuOpen, setMenuOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [orderStep, setOrderStep] = useState(1);
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDraggingInvoice, setIsDraggingInvoice] = useState(false);
  const [selectedInvoiceName, setSelectedInvoiceName] = useState("");
  const [hasUploadedInvoice, setHasUploadedInvoice] = useState(false);
  const [uploadStep, setUploadStep] = useState("upload");
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [showInvoiceSources, setShowInvoiceSources] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);
  const [draftItems, setDraftItems] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [catalogSource, setCatalogSource] = useState("loading");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetch("/api/requests")
      .then((response) => response.json())
      .then(({ requests: nextRequests }) => {
        setRequests(nextRequests);
        setSelectedRequestId(nextRequests[0]?.id || null);
      });
  }, []);

  useEffect(() => {
    fetch("/api/catalog")
      .then((response) => response.json())
      .then(({ categories, source }) => {
        setCatalog(categories || []);
        setCatalogSource(source || "unknown");
      })
      .catch(() => {
        setCatalog([]);
        setCatalogSource("unavailable");
      });
  }, []);

  useEffect(() => {
    if (!uploading) {
      setUploadProgress(0);
      return undefined;
    }

    setUploadProgress(12);
    const steps = [
      [600, 34],
      [1300, 62],
      [2200, 88],
      [2950, 100],
    ];
    const timers = steps.map(([delay, progress]) => {
      return window.setTimeout(() => setUploadProgress(progress), delay);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [uploading]);

  const selectedRequest = useMemo(() => {
    return requests.find((request) => request.id === selectedRequestId) || requests[0];
  }, [requests, selectedRequestId]);

  const lineItems = selectedRequest?.lineItems || [];
  const quoteTotal = sumSelected(lineItems);
  const previousTotal = sumPrevious(lineItems);
  const savings = Math.max(previousTotal - quoteTotal, 0);
  const visibleDraftItems = draftItems.filter((item) => item.documentIds.some((documentId) => uploadedDocs.some((doc) => doc.id === documentId)));
  const activeDraftItems = visibleDraftItems.filter((item) => item.included);
  const draftTotal = activeDraftItems.reduce((total, item) => total + item.draftQty * item.selected.unitPrice, 0);
  const draftPreviousTotal = activeDraftItems.reduce((total, item) => total + item.draftQty * item.oldUnitPrice, 0);
  const draftSavings = Math.max(draftPreviousTotal - draftTotal, 0);
  const recommendationStats = {
    matchedItems: visibleDraftItems.length,
    exactMatches: visibleDraftItems.filter((item) => item.recommendation?.matchType === "exact").length,
    substitutions: visibleDraftItems.filter((item) => ["equivalent", "substitute"].includes(item.recommendation?.matchType)).length,
    needsReview: visibleDraftItems.filter((item) => item.recommendation?.matchType === "needs_review").length,
    averageConfidence: visibleDraftItems.length
      ? Math.round(visibleDraftItems.reduce((total, item) => total + (item.recommendation?.confidence || 0), 0) / visibleDraftItems.length * 100)
      : 0,
    deliveryEstimate: visibleDraftItems.some((item) => item.recommendation?.matchType === "needs_review") ? "3-5 days" : "2-4 days",
  };
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const catalogMatches = useMemo(() => {
    if (!catalog.length) return [];

    if (!normalizedSearch) return catalog.slice(0, 5);

    return catalog.filter((category) => {
      const item = category.best_value_item || {};
      return [category.name, item.name, item.supplier_name, item.sku]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [catalog, normalizedSearch]);
  const catalogViewItems = normalizedSearch ? catalogMatches : catalog;

  function setView(nextView) {
    setViewState(nextView);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function enterBuyerPortal(nextView = "landing") {
    setIsLoggedIn(true);
    setViewState(nextView);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 2200);
  }

  function uploadInvoiceFile(fileInput, file) {
    if (!file || !fileInput || !uploadFormRef.current || uploading) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      showToast("Upload a PDF invoice for this demo");
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    setSelectedInvoiceName(file.name);
    window.setTimeout(() => {
      uploadFormRef.current?.requestSubmit();
    }, 0);
  }

  function handleInvoiceDrop(event) {
    event.preventDefault();
    setIsDraggingInvoice(false);
    uploadInvoiceFile(event.currentTarget.querySelector('input[type="file"]'), event.dataTransfer.files?.[0]);
  }

  async function handleUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setUploading(true);
    const startedAt = Date.now();
    const response = await fetch("/api/requests", {
      method: "POST",
      body: formData,
    });
    await wait(Math.max(PROCESSING_DURATION_MS - (Date.now() - startedAt), 0));

    if (!response.ok) {
      setUploading(false);
      const body = await response.json().catch(() => ({}));
      showToast(body.error || "Upload failed");
      return;
    }

    const { request } = await response.json();
    const documentId = request.id;
    setRequests((current) => [request, ...current]);
    setSelectedRequestId(request.id);
    setHasUploadedInvoice(true);
    setOrderSubmitted(false);
    setUploadStep("recommendation");
    setUploadedDocs((docs) => [
      ...docs,
      {
        id: documentId,
        name: request.sourceFileName,
        itemCount: request.lineItems.length,
      },
    ]);
    setDraftItems((items) => {
      const byProduct = new Map(items.map((item) => [item.product, item]));

      request.lineItems.forEach((item) => {
        const existing = byProduct.get(item.product);

        if (existing) {
          const documentQuantities = {
            ...(existing.documentQuantities || {}),
            [documentId]: ((existing.documentQuantities || {})[documentId] || 0) + item.qty,
          };

          byProduct.set(item.product, {
            ...existing,
            draftQty: existing.draftQty + item.qty,
            included: true,
            documentQuantities,
            documentIds: Array.from(new Set([...existing.documentIds, documentId])),
          });
          return;
        }

        byProduct.set(item.product, {
          ...item,
          draftQty: item.qty,
          included: true,
          documentQuantities: { [documentId]: item.qty },
          documentIds: [documentId],
        });
      });

      return Array.from(byProduct.values());
    });
    setOrderStep(1);
    setViewState("quote");
    setUploading(false);
    setSelectedInvoiceName("");
    form.reset();
    showToast("Invoice matched. Quote builder ready.");
  }

  function updateDraftQty(product, nextQty) {
    setDraftItems((items) => items.map((item) => {
      if (item.product !== product) return item;
      return { ...item, draftQty: Math.max(1, Number(nextQty) || 1) };
    }));
  }

  function removeDraftItem(product) {
    setDraftItems((items) => items.map((item) => {
      if (item.product !== product) return item;
      return { ...item, included: false };
    }));
  }

  function removeUploadedDoc(documentId) {
    const remainingDocs = uploadedDocs.filter((doc) => doc.id !== documentId);
    setUploadedDocs(remainingDocs);
    setDraftItems((items) => {
      return items
        .map((item) => {
          const documentIds = item.documentIds.filter((id) => id !== documentId);
          const documentQuantities = { ...(item.documentQuantities || {}) };
          const removedQty = documentQuantities[documentId] || 0;
          delete documentQuantities[documentId];
          return {
            ...item,
            draftQty: Math.max(1, item.draftQty - removedQty),
            documentQuantities,
            documentIds,
            included: documentIds.length > 0 && item.included,
          };
        })
        .filter((item) => item.documentIds.length > 0);
    });

    if (!remainingDocs.length) {
      setHasUploadedInvoice(false);
      setUploadStep("upload");
      setSelectedInvoiceName("");
      setShowInvoiceSources(false);
    } else if (uploadStep === "submit") {
      setUploadStep("review");
    }
  }

  function resetDraftOrder() {
    setUploadedDocs([]);
    setDraftItems([]);
    setHasUploadedInvoice(false);
    setUploadStep("upload");
    setSelectedInvoiceName("");
    setShowInvoiceSources(false);
    setSubmittingOrder(false);
    setOrderSubmitted(false);
    uploadFormRef.current?.reset();
  }

  function submitDraftOrder() {
    if (!activeDraftItems.length || submittingOrder) return;

    setSubmittingOrder(true);
    window.setTimeout(() => {
      setSubmittingOrder(false);
      setOrderSubmitted(true);
      setOrderStep(2);
      showToast("Order submitted");
    }, 900);
  }

  const navItems = [
    ["landing", "icon-home", "Dashboard"],
    ["upload", "icon-cloud-upload", "Uploads"],
    ["quote", "icon-file-text", "Quotes"],
    ["order", "icon-clipboard", "Orders"],
    ["supplier", "icon-users", "Suppliers"],
    ["settings", "icon-settings", "Settings"],
  ];

  if (!isLoggedIn) {
    return (
      <>
        <LoggedOutLanding onEnter={enterBuyerPortal} />
        <IconSprite />
      </>
    );
  }

  return (
    <>
      <div className={`app-shell ${menuOpen ? "menu-open" : ""}`}>
        <aside className="sidebar">
          <div className="brand-block">
            <BrandMark />
            <button
              className="mobile-menu-button"
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((isOpen) => !isOpen)}
            >
              <span></span><span></span><span></span>
            </button>
          </div>

          <nav className="nav-tabs" aria-label="Primary navigation">
            {navItems.map(([target, icon, label], index) => (
              <button key={`${label}-${index}`} className={`nav-tab ${(view === target || (view === "approval" && target === "quote")) ? "active" : ""}`} onClick={() => setView(target)}>
                <Icon name={icon} />
                <strong>{label}</strong>
              </button>
            ))}
          </nav>

          <div className="org-panel">
            <div className="avatar">AK</div>
            <div>
              <h2>Alex Kim</h2>
              <p>Operations Director</p>
            </div>
          </div>
        </aside>

        <main>
          <section className="topbar app-accountbar">
            <label className="global-search">
              <Icon name="icon-search" className="search-icon" />
              <input
                type="search"
                placeholder="Search requests, buyers, suppliers, invoices..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            {normalizedSearch && (
              <SearchResults
                results={catalogMatches}
                onViewCatalog={() => setView("quote")}
              />
            )}
            <button className="icon-button account-bell" type="button" aria-label="Notifications">
              <Icon name="icon-settings" className="button-icon" />
            </button>
            <button className="account-menu" type="button" aria-label="Account menu">
              <span className="avatar">AK</span>
              <span><strong>Alex Kim</strong><small>Buyer</small></span>
              <span aria-hidden="true">⌄</span>
            </button>
          </section>

          {view === "landing" && (
            <section className="view active" aria-labelledby="landingHeading">
              <DashboardPage onNewRequest={() => setView("upload")} />
            </section>
          )}

          {view === "catalog" && (
            <section className="view active" aria-labelledby="catalogPageHeading">
              <CatalogExplorer
                catalog={catalogViewItems}
                source={catalogSource}
                hasSearch={Boolean(normalizedSearch)}
                titleId="catalogPageHeading"
              />
            </section>
          )}

          {view === "upload" && (
            <section className="view active" data-testid="upload-view" aria-labelledby="uploadHeading">
              <div className="upload-page-heading">
                <h2 id="uploadHeading">Upload invoice or reorder list</h2>
                <p>Upload a supplier invoice or reorder list and we will extract line items for quick quoting.</p>
              </div>

              {!orderSubmitted && (
                <div className="upload-workspace">
                  <form ref={uploadFormRef} onSubmit={handleUpload} className={`upload-layout ${hasUploadedInvoice ? "compact-upload" : ""}`}>
                    <div
                      className={`upload-dropzone ${isDraggingInvoice ? "dragging" : ""}`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsDraggingInvoice(true);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          setIsDraggingInvoice(false);
                        }
                      }}
                      onDrop={handleInvoiceDrop}
                    >
                      <div className="upload-icon"><Icon name="icon-cloud-upload" /></div>
                      <h3>{uploading ? "Processing invoice..." : isDraggingInvoice ? "Drop your file here" : hasUploadedInvoice ? "Add another invoice" : "Drag and drop your file here"}</h3>
                      <p>{uploading ? selectedInvoiceName : selectedInvoiceName || "or select a file"}</p>
                      <span className="select-file-button"><Icon name="icon-cloud-upload" className="button-icon" />Select file</span>
                      <small>Accepted files: PDF, CSV, XLSX · Max file size: 20MB</small>
                      {uploading && (
                        <div className="processing-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
                          <div className="processing-track">
                            <div style={{ width: `${uploadProgress}%` }}></div>
                          </div>
                          <span>{uploadProgress < 45 ? "Reading PDF" : uploadProgress < 80 ? "Matching products" : "Building draft order"}</span>
                        </div>
                      )}
                      <input
                        className="file-input"
                        data-testid="invoice-file-input"
                        name="file"
                        type="file"
                        accept=".pdf,application/pdf"
                        required
                        onChange={(event) => uploadInvoiceFile(event.currentTarget, event.currentTarget.files?.[0])}
                      />
                      <button className="primary-action compact hidden-submit" data-testid="save-parse-request" type="submit" disabled={uploading}>Create Draft Order</button>
                      <input type="hidden" name="clinic" value="Northline Rehab" />
                      <input type="hidden" name="buyer" value="Alex Kim" />
                      <input type="hidden" name="shippingAddress" value="500 Healthcare Blvd, Nashville, TN" />
                      <input type="hidden" name="preference" value="Exact brand if possible, alternatives allowed" />
                    </div>

                    <div className="upload-fields">
                      <label>Supplier name <span>*</span>
                        <select name="supplierName" defaultValue="">
                          <option value="" disabled>Search or select supplier</option>
                          <option>Integrated Medical</option>
                          <option>Rehab Supply Co.</option>
                          <option>Clinical Direct</option>
                        </select>
                      </label>
                      <label>Order frequency
                        <select name="frequency" defaultValue="">
                          <option value="" disabled>Select frequency</option>
                          <option>One-time order</option>
                          <option>Monthly</option>
                          <option>Every 60 days</option>
                          <option>Quarterly</option>
                        </select>
                      </label>
                      <label>Needed by date
                        <input name="neededBy" type="text" placeholder="Select date" />
                      </label>
                      <label className="toggle-field">This is a recurring order
                        <span><i></i></span>
                        <small>Yes, this is a recurring order</small>
                      </label>
                      <label className="upload-notes">Notes <em>(optional)</em>
                        <textarea name="notes" maxLength="500" placeholder="Add any special instructions or details for this request..." />
                        <small>0/500</small>
                      </label>
                    </div>
                  </form>

                  <aside className="upload-help-rail">
                    <div className="next-card">
                      <h3>What happens next</h3>
                      <div className="next-step"><span><Icon name="icon-cloud-upload" className="button-icon" /></span><div><strong>1. We extract line items</strong><p>Our system reads your file and identifies the items and quantities.</p></div></div>
                      <div className="next-step"><span><Icon name="icon-users" className="button-icon" /></span><div><strong>2. We compare suppliers</strong><p>We compare vetted supplier options for price, speed, and product fit.</p></div></div>
                      <div className="next-step"><span><Icon name="icon-chart" className="button-icon" /></span><div><strong>3. You get the best quote</strong><p>Review recommendations and approve with confidence.</p></div></div>
                    </div>
                    <div className="support-card">
                      <Icon name="icon-settings" className="button-icon" />
                      <div><strong>Secure & private</strong><p>Your data is encrypted and never shared with suppliers without approval.</p><span>HIPAA-aware · SOC 2 aligned</span></div>
                    </div>
                    <div className="support-card">
                      <Icon name="icon-users" className="button-icon" />
                      <div><strong>Need help?</strong><p>Our team can help you upload and get the right quotes.</p><button type="button">Contact support</button></div>
                    </div>
                  </aside>

                  <div className="upload-submit-bar">
                    <button className="secondary-action compact" type="button" onClick={() => showToast("Draft saved")}>Save draft</button>
                    <button className="primary-action compact" type="button" onClick={() => uploadFormRef.current?.requestSubmit()} disabled={uploading}>
                      {uploading ? "Processing..." : "Submit for quote"}
                    </button>
                  </div>
                </div>
              )}

              {uploadedDocs.length > 0 && !orderSubmitted && (
                <div className="invoice-sources-bar">
                  <button className="secondary-action compact" type="button" onClick={() => setShowInvoiceSources(true)}>
                    <Icon name="icon-file-text" className="button-icon" />
                    {uploadedDocs.length} invoice source{uploadedDocs.length === 1 ? "" : "s"}
                  </button>
                  <button className="text-action clear-order-action" type="button" onClick={resetDraftOrder}>Start over</button>
                </div>
              )}

              {uploadStep === "recommendation" && (
                <RecommendationSummary
                  stats={recommendationStats}
                  total={draftTotal}
                  savings={draftSavings}
                  sourceCount={uploadedDocs.length}
                  onReview={() => setUploadStep("review")}
                />
              )}

              {uploadStep === "review" && (
                <DraftOrderReview
                  items={visibleDraftItems}
                  activeItems={activeDraftItems}
                  total={draftTotal}
                  onBack={() => setUploadStep("recommendation")}
                  onApprove={() => {
                    setUploadStep("submit");
                    showToast("Draft order ready");
                  }}
                  onRemove={removeDraftItem}
                  onQtyChange={updateDraftQty}
                />
              )}

              {uploadStep === "submit" && !orderSubmitted && (
                <DraftOrderConfirm
                  activeItems={activeDraftItems}
                  total={draftTotal}
                  sourceCount={uploadedDocs.length}
                  onBack={() => setUploadStep("review")}
                  onSubmit={submitDraftOrder}
                  submitting={submittingOrder}
                />
              )}

              {orderSubmitted && (
                <DraftOrderSubmitted
                  activeItems={activeDraftItems}
                  total={draftTotal}
                  sourceCount={uploadedDocs.length}
                  onStartOver={resetDraftOrder}
                />
              )}
            </section>
          )}

          {view === "admin" && (
            <section className="view active" data-testid="admin-view" aria-labelledby="adminHeading">
              <div className="section-heading first">
                <div>
                  <h2 id="adminHeading">Admin dashboard</h2>
                  <p>Parse buyer uploads, normalize line items, and send RFQs to vetted suppliers.</p>
                </div>
                <button className="primary-action compact" onClick={() => { showToast("RFQs sent to 5 vetted suppliers"); setView("quote"); }}>Send RFQs</button>
              </div>

              <div className="metric-band">
                <div><strong>{lineItems.length || 0}</strong><span>items parsed</span></div>
                <div><strong>5</strong><span>suppliers matched</span></div>
                <div><strong>3</strong><span>exact brand matches</span></div>
                <div><strong>18%</strong><span>target savings</span></div>
              </div>

              <div className="admin-layout">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Canonical Product</th>
                        <th>Extracted From</th>
                        <th>Supplier Outreach</th>
                        <th>Needed By</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item) => (
                        <tr key={item.product}>
                          <td><strong>{item.product}</strong><br /><span>{item.qty} {item.unit}</span></td>
                          <td>{item.extractedFrom}</td>
                          <td>{item.outreach}</td>
                          <td>{item.neededBy}</td>
                          <td><span className={`status-chip ${statusClass(item.status)}`}>{item.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ops-panel">
                  <p className="eyebrow">Supplier Vetting</p>
                  <h3>RFQ shortlist</h3>
                  <div className="supplier-list">
                    {suppliers.map((supplier) => (
                      <div className="supplier-card" key={supplier.name}>
                        <strong>{supplier.name}</strong>
                        <span>{supplier.signal}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {view === "quote" && (
            <section className="view active quote-builder-view" aria-labelledby="quoteHeading">
              <QuoteBuilderPage
                lineItems={lineItems}
                quoteTotal={quoteTotal}
                previousTotal={previousTotal}
                savings={savings}
                onUploadAnother={() => setView("upload")}
                onPublish={() => {
                  setView("approval");
                  showToast("Quote published to buyer");
                }}
                onSave={() => showToast("Quote saved as draft")}
              />
            </section>
          )}

          {view === "approval" && (
            <section className="view active review-quote-view" aria-labelledby="approvalHeading">
              <ReviewQuotePage
                lineItems={lineItems}
                quoteTotal={quoteTotal}
                previousTotal={previousTotal}
                savings={savings}
                onBack={() => setView("quote")}
                onApprove={() => {
                  setOrderStep(1);
                  showToast("Quote approved. Order placed.");
                  setView("order");
                }}
                onRevision={() => {
                  showToast("Revision request noted.");
                  setView("quote");
                }}
              />
            </section>
          )}

          {view === "order" && (
            <section className="view active order-detail-view" aria-labelledby="orderHeading">
              <OrderDetailPage
                lineItems={lineItems}
                onDownload={() => showToast("PO download prepared")}
                onReorder={() => setView("upload")}
              />
            </section>
          )}

          {view === "supplier" && (
            <section className="view active" aria-labelledby="supplierHeading">
              <div className="supplier-landing">
                <p className="pill">For Suppliers</p>
                <h2 id="supplierHeading">Sell into PT, chiro, and rehab clinics through MedMKP.</h2>
                <p>
                  Supplier onboarding is coming next. For now, this portal will support catalog uploads,
                  compliance review, storefront setup, inventory updates, and order fulfillment.
                </p>
                <div className="supplier-actions">
                  <button className="primary-action compact" onClick={() => showToast("Supplier login coming soon")}>
                    Supplier Login
                  </button>
                  <button className="secondary-action compact" onClick={() => setView("landing")}>
                    Back to Buyer Portal
                  </button>
                </div>
                <div className="supplier-feature-grid">
                  <div><Icon name="icon-cloud-upload" className="button-icon" /><strong>Catalog upload</strong><span>CSV, PDF, or portal-assisted SKU intake.</span></div>
                  <div><Icon name="icon-package" className="button-icon" /><strong>Storefront setup</strong><span>Supplier profile, EIN, certifications, and service lanes.</span></div>
                  <div><Icon name="icon-clipboard" className="button-icon" /><strong>Order fulfillment</strong><span>Receive confirmed clinic orders after buyer approval.</span></div>
                </div>
              </div>
            </section>
          )}

          {view === "settings" && (
            <section className="view active" aria-labelledby="settingsHeading">
              <div className="section-heading first">
                <div>
                  <h2 id="settingsHeading">Settings</h2>
                  <p>Manage buyer profile, ordering preferences, and procurement defaults.</p>
                </div>
              </div>
              <div className="settings-grid">
                <div className="ops-panel">
                  <p className="eyebrow">Buyer Profile</p>
                  <h3>Alex Kim</h3>
                  <p>Northline Rehab · Operations Director</p>
                </div>
                <div className="ops-panel">
                  <p className="eyebrow">Ordering Defaults</p>
                  <h3>Exact brand if possible</h3>
                  <p>Allow vetted equivalents when they reduce cost and preserve product quality.</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
      {showInvoiceSources && (
        <InvoiceSourcesModal
          docs={uploadedDocs}
          onClose={() => setShowInvoiceSources(false)}
          onRemove={removeUploadedDoc}
        />
      )}
      <IconSprite />
    </>
  );
}

function RequestPicker({ requests, selectedRequestId, onSelect }) {
  if (!requests.length) return null;

  return (
    <div className="request-picker">
              <label>
        Active request
        <select data-testid="active-request-picker" value={selectedRequestId || ""} onChange={(event) => onSelect(event.target.value)}>
          {requests.map((request) => (
            <option key={request.id} value={request.id}>
              {request.clinic} · {request.sourceFileName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CatalogExplorer({ catalog, source, hasSearch, titleId = "catalogHeading" }) {
  return (
    <section className="catalog-panel" aria-labelledby={titleId}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Canonical Catalog</p>
          <h2 id={titleId}>{hasSearch ? "Search results" : "PT/Rehab reorder categories"}</h2>
          <p>Buyer-facing products are canonical. Supplier-specific SKUs sit underneath as best-value offers.</p>
        </div>
        <span className={`status-chip ${source === "medusa" ? "success" : "warning"}`}>
          {source === "medusa" ? "Medusa live" : "Fallback catalog"}
        </span>
      </div>

      <div className="catalog-grid">
        {catalog.map((category) => {
          const item = category.best_value_item || {};
          const price = typeof item.unit_price_cents === "number"
            ? money.format(item.unit_price_cents / 100)
            : "Price pending";

          return (
            <article className="catalog-card" key={category.id}>
              <div>
                <span className="catalog-category">{category.name}</span>
                <h3>{item.name || category.name}</h3>
              </div>
              <div className="catalog-meta">
                <span>{category.supplier_count || 0} supplier{category.supplier_count === 1 ? "" : "s"}</span>
                <span>{item.inventory_status?.replace("_", " ") || "stock unknown"}</span>
                <span>{item.lead_time_days ? `${item.lead_time_days} days` : "lead time pending"}</span>
              </div>
              <div className="catalog-offer">
                <span>Best value</span>
                <strong>{price}</strong>
              </div>
              <p>{item.supplier_name || "Supplier pending"}</p>
            </article>
          );
        })}
      </div>

      {!catalog.length && (
        <div className="empty-state">
          <strong>No matching products</strong>
          <span>Try therapy bands, gloves, tape, electrodes, or foam rollers.</span>
        </div>
      )}
    </section>
  );
}

function SearchResults({ results, onViewCatalog }) {
  return (
    <div className="search-results" role="region" aria-label="Catalog search results">
      <div className="search-results-header">
        <strong>{results.length ? "Matching catalog products" : "No catalog matches"}</strong>
        <button type="button" onClick={onViewCatalog}>View catalog</button>
      </div>
      {results.slice(0, 5).map((category) => {
        const item = category.best_value_item || {};
        const price = typeof item.unit_price_cents === "number"
          ? money.format(item.unit_price_cents / 100)
          : "Price pending";

        return (
          <button className="search-result" type="button" key={category.id} onClick={onViewCatalog}>
            <span>
              <strong>{item.name || category.name}</strong>
              <small>{category.name} · {item.supplier_name || "Supplier pending"}</small>
            </span>
            <em>{price}</em>
          </button>
        );
      })}
      {!results.length && (
        <p>Try therapy bands, gloves, tape, electrodes, or foam rollers.</p>
      )}
    </div>
  );
}

const dashboardQueue = [
  ["HM", "HealthCo Medical", "John Smith", "INV-2024-0521.pdf", "New", "0 / 6", 0, "May 24, 2024", "3 days left"],
  ["PC", "PrimeCare Partners", "Emily Davis", "supply_list_may.pdf", "Reviewing", "2 / 6", 34, "May 28, 2024", "7 days left"],
  ["NW", "Northwest Hospital", "Michael Lee", "implants_quote.xlsx", "Outreaching", "4 / 7", 58, "May 30, 2024", "9 days left"],
  ["GH", "GoodHealth Systems", "Sarah Johnson", "reorder_request.pdf", "Reviewing", "1 / 5", 20, "Jun 2, 2024", "12 days left"],
  ["BC", "BayCare Medical", "David Brown", "disposables_list.pdf", "New", "0 / 5", 0, "Jun 3, 2024", "13 days left"],
  ["MV", "MetroView Health", "Jessica Miller", "equipment_needs.pdf", "Outreaching", "3 / 6", 50, "Jun 4, 2024", "14 days left"],
];

const priorities = [
  ["HealthCo Medical request due", "INV-2024-0521.pdf", "3 days left", "urgent"],
  ["PrimeCare Partners follow up", "2 quotes pending", "Today", "today"],
  ["Northwest Hospital outreach", "3 suppliers not yet contacted", "Today", "today"],
  ["BayCare Medical new request", "Disposables & supplies", "Tomorrow", "normal"],
];

const supplierActivity = [
  ["MediCore Medical", "Responded to HealthCo Medical", "10m ago"],
  ["HealthPro Supplies", "Submitted a new quote", "25m ago"],
  ["PrimeMed Distributors", "Responded to Northwest Hospital", "1h ago"],
  ["SurgiMax Solutions", "Viewed request details", "2h ago"],
  ["MedLine Industries", "Submitted a new quote", "2h ago"],
];

function DashboardPage({ onNewRequest }) {
  return (
    <div className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <h2 id="landingHeading">Dashboard</h2>
          <p>Overview of procurement activity and priorities</p>
        </div>
      </div>

      <div className="dashboard-layout">
        <div className="dashboard-main">
          <div className="dashboard-metrics">
            <DashboardMetric icon="icon-file-plus" label="New requests" value="18" delta="12%" tone="up" />
            <DashboardMetric icon="icon-file-text" label="Quotes in progress" value="36" delta="8%" tone="up" />
            <DashboardMetric icon="icon-package" label="Orders pending" value="24" delta="4%" tone="down" />
          </div>

          <section className="dashboard-card work-queue-card">
            <div className="dashboard-card-header">
              <div>
                <h3>Work queue</h3>
                <p>Incoming buyer requests</p>
              </div>
              <div className="dashboard-card-actions">
                <button className="secondary-action compact" type="button">Filters</button>
                <button className="primary-action compact" type="button" onClick={onNewRequest}>New Request</button>
              </div>
            </div>
            <div className="work-table">
              <div className="work-table-head">
                <span>Buyer</span><span>File</span><span>Status</span><span>Supplier outreach</span><span>Needed by</span><span></span>
              </div>
              {dashboardQueue.map(([initials, buyer, contact, file, status, outreach, progress, needed, due]) => (
                <article className="work-row" key={file}>
                  <div className="buyer-cell"><span>{initials}</span><strong>{buyer}</strong><small>{contact}</small></div>
                  <a href="#">{file}</a>
                  <span className={`queue-status ${status.toLowerCase()}`}>{status}</span>
                  <div className="outreach-cell"><strong>{outreach}</strong><i><b style={{ width: `${progress}%` }}></b></i></div>
                  <div className="needed-cell"><strong>{needed}</strong><small>{due}</small></div>
                  <button className="text-action" type="button">•••</button>
                </article>
              ))}
            </div>
            <button className="text-action dashboard-link" type="button">View all requests</button>
          </section>

          <section className="dashboard-card request-chart-card">
            <div className="dashboard-card-header">
              <div>
                <h3>Request volume</h3>
                <p>Number of new requests by week</p>
              </div>
              <div className="dashboard-card-actions">
                <button className="secondary-action compact" type="button">Last 8 weeks</button>
                <button className="secondary-action compact" type="button">Export</button>
              </div>
            </div>
            <div className="line-chart" aria-label="Request volume chart">
              <svg viewBox="0 0 760 190" role="img">
                <path d="M20 150H740M20 110H740M20 70H740M20 30H740" />
                <polyline points="28,145 132,108 236,130 340,85 444,70 548,112 652,58 736,96" />
                {[["28","145"],["132","108"],["236","130"],["340","85"],["444","70"],["548","112"],["652","58"],["736","96"]].map(([cx, cy]) => <circle cx={cx} cy={cy} r="5" key={`${cx}-${cy}`} />)}
              </svg>
              <div className="chart-labels"><span>Mar 25-31</span><span>Apr 1-7</span><span>Apr 8-14</span><span>Apr 15-21</span><span>Apr 22-28</span><span>Apr 29-May 5</span><span>May 6-12</span><span>May 13-19</span></div>
            </div>
            <div className="chart-legend"><span></span>New requests</div>
          </section>
        </div>

        <aside className="dashboard-rail">
          <DashboardMetric icon="icon-chart" label="Month's GMV" value="$1.24M" delta="15%" tone="up" featured />
          <section className="dashboard-card priority-card">
            <div className="dashboard-card-header"><h3>Today's priorities</h3><span className="count-pill">6</span></div>
            {priorities.map(([title, detail, due, tone]) => (
              <article className={`priority-row ${tone}`} key={title}>
                <Icon name="icon-file-plus" className="button-icon" />
                <span><strong>{title}</strong><small>{detail}</small></span>
                <em>{due}</em>
              </article>
            ))}
            <button className="text-action dashboard-link" type="button">View all tasks</button>
          </section>

          <section className="dashboard-card activity-card">
            <div className="dashboard-card-header"><h3>Supplier activity</h3><button className="text-action" type="button">View all</button></div>
            {supplierActivity.map(([name, detail, time]) => (
              <article className="activity-row" key={`${name}-${time}`}>
                <span>{name.slice(0, 2).toUpperCase()}</span>
                <div><strong>{name}</strong><small>{detail}</small></div>
                <em>{time}</em>
              </article>
            ))}
            <button className="text-action dashboard-link" type="button">View all activity</button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DashboardMetric({ icon, label, value, delta, tone, featured = false }) {
  return (
    <article className={`dashboard-metric ${featured ? "featured" : ""}`}>
      <span className="metric-icon"><Icon name={icon} className="button-icon" /></span>
      <div>
        <strong>{label}</strong>
        <b>{value}</b>
        <small className={tone}>{tone === "down" ? "↓" : "↑"} {delta} vs last 7 days</small>
      </div>
    </article>
  );
}

const quoteLineItems = [
  ["Surgical Mask, 3-Ply", "MKP-1001", "Box of 50", 200, "boxes", 4.65, 3.92, "MediCore Medical"],
  ["Nitrile Exam Gloves, M", "MKP-2002", "Box of 100", 150, "boxes", 6.8, 5.95, "HealthPro Supplies"],
  ["IV Catheter 20G", "MKP-3003", "Box of 50", 300, "boxes", 12.3, 11.2, "PrimeMed Distributors"],
  ["Syringe 10ml", "MKP-4004", "Box of 100", 250, "boxes", 9.15, 8.2, "MediCore Medical"],
  ["Alcohol Prep Pads", "MKP-5005", "Box of 200", 100, "boxes", 3.2, 2.85, "HealthPro Supplies"],
];

const supplierQuoteCards = [
  ["MediCore Medical", "$18,392.00", "-25% vs current", "2-3 days", "$450.00", "$1,000", "98% (★ 4.8)", true],
  ["HealthPro Supplies", "$19,845.20", "-19% vs current", "3-5 days", "$550.00", "$1,000", "95% (★ 4.6)", false],
  ["PrimeMed Distributors", "$20,617.50", "-16% vs current", "4-6 days", "$620.00", "$1,500", "96% (★ 4.5)", false],
];

const quoteSupplierOptions = [
  "MediCore Medical",
  "HealthPro Supplies",
  "PrimeMed Distributors",
  "SurgiMax Solutions",
  "MedLine Industries",
];

function supplierToneClass(name) {
  const knownIndex = quoteSupplierOptions.indexOf(name);
  if (knownIndex >= 0) return `supplier-tone-${knownIndex + 1}`;

  const hash = name.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return `supplier-tone-${(hash % 5) + 1}`;
}

function QuoteBuilderPage({ lineItems, quoteTotal, previousTotal, savings, onUploadAnother, onPublish, onSave }) {
  const displayItems = lineItems.length
    ? lineItems.slice(0, 5).map((item, index) => [
      item.product,
      `MKP-${String(index + 1).padStart(4, "0")}`,
      item.unit,
      item.qty,
      item.unit,
      item.oldUnitPrice,
      item.selected.unitPrice,
      item.selected.supplier,
    ])
    : quoteLineItems;
  const subtotal = quoteTotal || 18392;
  const markup = subtotal * 0.12;
  const shipping = 450;
  const total = subtotal + markup + shipping;
  const estimatedSavings = savings || Math.max((previousTotal || 24520.8) - subtotal, 0);
  const [supplierSelections, setSupplierSelections] = useState({});

  return (
    <div className="quote-builder-page">
      <header className="quote-builder-header">
        <div>
          <p>Quotes</p>
          <h2 id="quoteHeading">Quote Builder, INV-2024-0517 <span>Draft</span></h2>
          <small>Requested on May 17, 2024 · {displayItems.length} line items · MedSupply Co.</small>
        </div>
        <div>
          <button className="secondary-action compact" type="button" onClick={onUploadAnother}>
            <Icon name="icon-cloud-upload" className="button-icon" />
            Upload Another Invoice
          </button>
          <button className="icon-button" type="button" aria-label="More quote actions">•••</button>
        </div>
      </header>

      <div className="quote-builder-grid">
        <div className="quote-builder-main">
          <section className="quote-card quote-line-card">
            <div className="quote-card-header">
              <h3>Line items ({displayItems.length})</h3>
              <div className="quote-search-actions">
                <label className="quote-search">
                  <Icon name="icon-search" className="button-icon" />
                  <input type="search" placeholder="Search by product or SKU" />
                </label>
                <button className="secondary-action compact" type="button">Filters</button>
                <button className="icon-button" type="button" aria-label="Line item settings">
                  <Icon name="icon-settings" className="button-icon" />
                </button>
              </div>
            </div>
            <div className="quote-line-table">
              <div className="quote-line-head">
                <span>Product</span><span>Qty</span><span>Current price</span><span>Best quote</span><span>Selected supplier</span>
              </div>
              {displayItems.map(([product, sku, pack, qty, unit, current, best, supplier]) => {
                const selectedSupplier = supplierSelections[sku] || supplier;
                const rowSupplierOptions = quoteSupplierOptions.includes(supplier)
                  ? quoteSupplierOptions
                  : [supplier, ...quoteSupplierOptions];

                return (
                  <article className="quote-line-row" key={sku}>
                    <div><strong>{product}</strong><small>SKU: {sku}</small><small>{pack}</small></div>
                    <span>{qty}<small>{unit}</small></span>
                    <span>{money.format(current)}<small>/ box</small></span>
                    <span className="best-quote">{money.format(best)}<small>/ box</small></span>
                    <label className="supplier-select">
                      <span className={supplierToneClass(selectedSupplier)}>{selectedSupplier[0]}</span>
                      <select
                        value={selectedSupplier}
                        aria-label={`Selected supplier for ${product}`}
                        onChange={(event) => {
                          setSupplierSelections((currentSelections) => ({
                            ...currentSelections,
                            [sku]: event.target.value,
                          }));
                        }}
                      >
                        {rowSupplierOptions.map((option) => (
                          <option value={option} key={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  </article>
                );
              })}
            </div>
            <div className="quote-line-footer">
              <button className="secondary-action compact" type="button">Add line item</button>
              <button className="text-action" type="button">Export comparison</button>
            </div>
          </section>

          <section className="quote-health-card">
            <div><Icon name="icon-chart" className="landing-step-icon" /><strong>Price competitiveness</strong><span>Excellent</span><p>This quote is 25% lower than current pricing.</p></div>
            <div><Icon name="icon-settings" className="landing-step-icon" /><strong>Supplier coverage</strong><span>High</span><p>3 suppliers · 98% of items competitively quoted.</p></div>
            <div><Icon name="icon-clipboard" className="landing-step-icon" /><strong>Risk assessment</strong><span>Low</span><p>All suppliers meet reliability standards.</p></div>
          </section>
        </div>

        <aside className="quote-builder-side">
          <section className="quote-card supplier-compare-card">
            <div className="quote-card-header">
              <h3>Compare supplier quotes</h3>
              <button className="text-action" type="button">View full comparison</button>
            </div>
            <div className="supplier-quote-grid">
              {supplierQuoteCards.map(([name, price, savingsText, lead, ship, moq, reliability, best]) => (
                <article className={`supplier-quote ${best ? "best" : ""}`} key={name}>
                  {best && <span className="best-match">Best match</span>}
                  <div className={`supplier-avatar ${supplierToneClass(name)}`}>{name[0]}</div>
                  <h4>{name}</h4>
                  <strong>{price}</strong>
                  <small>{savingsText}</small>
                  <dl>
                    <div><dt>Lead time</dt><dd>{lead}</dd></div>
                    <div><dt>Shipping</dt><dd>{ship}</dd></div>
                    <div><dt>MOQ</dt><dd>{moq}</dd></div>
                    <div><dt>Reliability</dt><dd>{reliability}</dd></div>
                  </dl>
                  <button className="text-action" type="button">View details</button>
                </article>
              ))}
            </div>
          </section>

          <div className="quote-side-lower">
            <section className="quote-card quote-controls-card">
              <label>Markup % <input defaultValue="12" /></label>
              <label>Substitution approval <select defaultValue="approval"><option value="approval">Allow with approval</option><option>No substitutions</option></select></label>
              <label>Shipping method <select defaultValue="standard"><option value="standard">Standard (3-5 days)</option><option>Fastest available</option></select></label>
              <label>Notes to buyer <textarea defaultValue={"Sourced from 3 vetted suppliers.\nAll items meet requested specs.\n\nSubstitutions allowed with approval to ensure best availability and pricing."} /></label>
              <small>180 characters remaining</small>
            </section>

            <section className="quote-card quote-summary-card">
              <h3>Quote summary</h3>
              <div><span>Subtotal ({displayItems.length} items)</span><strong>{money.format(subtotal)}</strong></div>
              <div><span>Markup (12%)</span><strong>{money.format(markup)}</strong></div>
              <div><span>Estimated savings</span><strong className="positive">-{money.format(estimatedSavings)}</strong></div>
              <div><span>Shipping (est.)</span><strong>{money.format(shipping)}</strong></div>
              <div className="quote-total"><span>Total</span><strong>{money.format(total)}</strong></div>
              <p>You are saving 25% vs current pricing<br />{money.format(estimatedSavings)} in total savings</p>
              <button className="primary-action" type="button" onClick={onPublish}>Publish quote to buyer</button>
              <button className="secondary-action" type="button" onClick={onSave}>Save as draft</button>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

const reviewQuoteFallbackItems = [
  ["Nitrile Exam Gloves", "Powder-Free, Medium", 10, "box", "MediCore Medical", 7.8, null],
  ["Surgical Mask, Level 3", "Blue, Ear Loop", 50, "box", "HealthPro Supplies", 4.25, null],
  ["IV Catheter 20G", "1.16 in, Yellow", 50, "box", "PrimeMed Distributors", 12.4, 15.6],
  ["Alcohol Prep Pads", "Sterile, Medium", 100, "box", "MediCore Medical", 1.65, 1.95],
  ["Syringe 3mL", "Luer Lock", 200, "box", "HealthPro Supplies", 6.9, null],
  ["Gauze Pads 4 x 4", "12 Ply, Sterile", 100, "box", "PrimeMed Distributors", 2.95, null],
];

function ReviewQuotePage({ lineItems, quoteTotal, previousTotal, savings, onBack, onApprove, onRevision }) {
  const quotedItems = lineItems.length
    ? lineItems.slice(0, 6).map((item, index) => [
      item.product,
      item.matchType || "Matched catalog item",
      item.qty,
      item.unit,
      item.selected.supplier,
      item.selected.unitPrice,
      index % 3 === 2 ? item.oldUnitPrice : null,
    ])
    : reviewQuoteFallbackItems;
  const subtotal = quoteTotal || 19170.2;
  const originalAmount = previousTotal || 24650;
  const shipping = 75;
  const taxes = 600;
  const total = subtotal + shipping + taxes;
  const estimatedSavings = savings || Math.max(originalAmount - subtotal, 0);
  const savingsPercent = Math.round((estimatedSavings / originalAmount) * 100);

  return (
    <div className="review-quote-page">
      <div className="review-quote-main">
        <button className="back-link" type="button" onClick={onBack}>Back to quotes</button>

        <header className="review-quote-header">
          <h2 id="approvalHeading">Review your quote <span>Quote #Q-2024-0517</span> <em>Complete</em></h2>
          <p>Please review the details below. When you are ready, approve and place your order.</p>
        </header>

        <section className="review-savings-card">
          <div><span>Original invoice amount</span><strong>{money.format(originalAmount)}</strong></div>
          <div><span>New quoted amount</span><strong className="positive">{money.format(total)}</strong></div>
          <div className="review-savings-highlight"><span>Estimated savings</span><strong>{savingsPercent}%</strong><b>{money.format(estimatedSavings)}</b></div>
          <div><span>Estimated lead time</span><strong>3-5 business days</strong><small>After order confirmation</small></div>
        </section>

        <section className="review-items-card">
          <div className="review-items-header">
            <h3>Quoted items (32)</h3>
            <div>
              <button className="secondary-action compact" type="button">View by: All items</button>
              <button className="secondary-action compact" type="button">Export</button>
            </div>
          </div>
          <div className="review-items-table">
            <div className="review-items-head">
              <span>Product</span><span>Quantity</span><span>Selected supplier</span><span>Unit price</span><span>Total</span><span>Substitution</span>
            </div>
            {quotedItems.map(([product, detail, qty, unit, supplier, unitPrice, originalPrice], index) => {
              const substituted = Boolean(originalPrice);
              const rowTotal = qty * unitPrice;

              return (
                <article className="review-item-row" key={`${product}-${index}`}>
                  <div className="review-product-cell">
                    <span className="review-product-thumb"><Icon name={index % 2 ? "icon-cloud-upload" : "icon-package"} className="button-icon" /></span>
                    <strong>{product}</strong>
                    <small>{detail}</small>
                  </div>
                  <span>{qty}<small>{unit}</small>{substituted && <b>Substituted</b>}</span>
                  <span>{supplier}<i className={supplierToneClass(supplier)}>{supplier[0]}</i></span>
                  <span>{money.format(unitPrice)}{substituted && <del>{money.format(originalPrice)}</del>}</span>
                  <span>{money.format(rowTotal)}{substituted && <del>{money.format(qty * originalPrice)}</del>}</span>
                  <span>{substituted ? <><strong className="approved-sub">Approved substitution</strong><small>Equal or better quality</small></> : "-"}</span>
                </article>
              );
            })}
          </div>
          <button className="secondary-action compact review-more-button" type="button">View all 32 items</button>
        </section>

        <section className="substitution-banner">
          <Icon name="icon-clipboard" className="button-icon" />
          <div><strong>All substitutions reviewed and approved</strong><p>You have 2 approved substitutions in this quote.</p></div>
          <button className="text-action" type="button">View substitutions</button>
        </section>
      </div>

      <aside className="review-quote-side">
        <section className="review-side-card">
          <div><h3>Quote notes</h3><button className="text-action" type="button">Edit</button></div>
          <p>We secured better pricing on high-volume items and included equivalent or upgraded substitutions where appropriate.</p>
          <p>All items are in stock and ready to ship.</p>
        </section>
        <section className="review-side-card">
          <div><h3>Shipping address</h3><button className="text-action" type="button">Edit</button></div>
          <p><strong>Downtown Medical Clinic</strong><br />123 Health Way<br />Suite 200<br />Chicago, IL 60601<br />United States</p>
        </section>
        <section className="review-side-card">
          <div><h3>Payment method</h3><button className="text-action" type="button">Edit</button></div>
          <label><input type="radio" defaultChecked name="payment" /> Send invoice / Net 30 <small>Pay by invoice within 30 days</small></label>
          <label><input type="radio" name="payment" /> Pay by credit card <small>Secure online payment</small></label>
        </section>
        <section className="review-side-card order-summary-card">
          <h3>Order summary</h3>
          <div><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div>
          <div><span>Shipping</span><strong>{money.format(shipping)}</strong></div>
          <div><span>Taxes</span><strong>{money.format(taxes)}</strong></div>
          <div className="quote-total"><span>Total</span><strong>{money.format(total)}</strong></div>
          <p>You save {money.format(estimatedSavings)} ({savingsPercent}%)</p>
          <button className="primary-action" type="button" onClick={onApprove}>Approve and place order</button>
          <button className="secondary-action" type="button" onClick={onRevision}>Request revision</button>
          <small>Secure · HIPAA-aware<br />Your data is never shared with suppliers.</small>
        </section>
      </aside>
    </div>
  );
}

const orderFallbackItems = [
  ["Nitrile Exam Gloves", "Size: Large · Blue · 100/Box", "NG-L-B100", "MediCore Medical", 20, "boxes", 8.75, "PO sent"],
  ["Surgical Face Masks", "3-Ply · Ear Loop · 50/Box", "SM-3P-50", "HealthPro Supplies", 10, "boxes", 6.4, "Approved"],
  ["Disinfectant Wipes", "6 x 7 · 160/Canister", "DW-160", "PrimeMed Distributors", 6, "canisters", 7.95, "Approved"],
];

function OrderDetailPage({ lineItems, onDownload, onReorder }) {
  const orderedItems = lineItems.length
    ? lineItems.slice(0, 3).map((item, index) => [
      item.product,
      item.matchType || item.unit,
      `MKP-${String(index + 1).padStart(4, "0")}`,
      item.selected.supplier,
      item.qty,
      item.unit,
      item.selected.unitPrice,
      index === 0 ? "PO sent" : "Approved",
    ])
    : orderFallbackItems;
  const subtotal = orderedItems.reduce((sum, [, , , , qty, , unitPrice]) => sum + qty * unitPrice, 0);
  const shipping = 18.5;
  const tax = 24.48;
  const total = subtotal + shipping + tax;

  return (
    <div className="order-detail-page">
      <div className="order-detail-main">
        <header className="order-detail-header">
          <div>
            <h2 id="orderHeading">Order #ORD-20481 <span>Approved</span></h2>
            <p>Placed May 17, 2024 · 3:42 PM</p>
          </div>
          <div>
            <button className="secondary-action compact" type="button" onClick={onDownload}>
              <Icon name="icon-cloud-upload" className="button-icon" />
              Download PO
            </button>
            <button className="primary-action compact" type="button" onClick={onReorder}>
              <Icon name="icon-clipboard" className="button-icon" />
              Reorder All
            </button>
          </div>
        </header>

        <section className="order-progress-card">
          {[
            ["Approved", "May 17, 3:42 PM", "icon-clipboard", true],
            ["PO sent", "May 17, 4:15 PM", "icon-file-text", true],
            ["Supplier confirmed", "Pending", "icon-store", false],
            ["Shipped", "Pending", "icon-package", false],
            ["Delivered", "Pending", "icon-package", false],
          ].map(([label, detail, icon, done], index, steps) => (
            <article className={done ? "done" : ""} key={label}>
              <span><Icon name={icon} className="button-icon" /></span>
              {index < steps.length - 1 && <i></i>}
              <strong>{label}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </section>

        <div className="order-info-grid">
          <section className="order-info-card">
            <h3>Supplier</h3>
            <div className="order-supplier">
              <span className="supplier-tone-1">M</span>
              <div><strong>MediCore Medical</strong><small>98% on-time · 4.8 ★</small></div>
            </div>
            <button className="secondary-action" type="button">View Supplier</button>
          </section>
          <section className="order-info-card centered">
            <h3>Shipment Tracking</h3>
            <Icon name="icon-package" className="order-info-icon" />
            <p>Tracking available once your order ships.</p>
          </section>
          <section className="order-info-card">
            <h3>Estimated Delivery</h3>
            <div className="delivery-date"><Icon name="icon-clipboard" className="order-info-icon" /><strong>May 24, 2024</strong><span>7 days remaining</span></div>
            <button className="secondary-action" type="button">View Details</button>
          </section>
        </div>

        <section className="reorder-reminder-card">
          <Icon name="icon-settings" className="button-icon" />
          <div><strong>Reorder Reminder</strong><p>Never run out of important supplies. We will remind you before it is time to reorder.</p></div>
          <span>Reminder every 30 days</span>
          <button className="secondary-action compact" type="button">Edit Reminder</button>
        </section>

        <section className="ordered-items-card">
          <h3>Ordered Items ({orderedItems.length})</h3>
          <div className="ordered-items-table">
            <div className="ordered-items-head">
              <span>Item</span><span>Supplier</span><span>Qty</span><span>Unit Price</span><span>Total</span><span>Status</span>
            </div>
            {orderedItems.map(([product, detail, sku, supplier, qty, unit, unitPrice, status], index) => (
              <article className="ordered-item-row" key={`${product}-${sku}`}>
                <div className="ordered-product-cell">
                  <span><Icon name={index === 2 ? "icon-package" : "icon-cloud-upload"} className="button-icon" /></span>
                  <strong>{product}</strong>
                  <small>{detail}<br />SKU: {sku}</small>
                </div>
                <span>{supplier}</span>
                <span>{qty} {unit}</span>
                <span>{money.format(unitPrice)}</span>
                <span>{money.format(qty * unitPrice)}</span>
                <b className={status === "PO sent" ? "po-sent" : ""}>{status}</b>
              </article>
            ))}
          </div>
          <button className="text-action ordered-more" type="button">View item details</button>
        </section>
      </div>

      <aside className="order-detail-side">
        <section className="order-side-card">
          <h3>Order Summary</h3>
          <div><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div>
          <div><span>Shipping</span><strong>{money.format(shipping)}</strong></div>
          <div><span>Tax</span><strong>{money.format(tax)}</strong></div>
          <div className="order-side-total"><span>Total</span><strong>{money.format(total)}</strong></div>
          <p>You saved $26.40 with contract pricing.</p>
        </section>
        <section className="order-side-card">
          <h3>Shipping Address</h3>
          <p><strong>Cityview Medical Center</strong><br />Attn: Receiving Dock<br />500 Healthcare Blvd.<br />Nashville, TN 37203<br />United States</p>
          <button className="secondary-action" type="button">View / Edit Address</button>
        </section>
        <section className="order-side-card">
          <h3>Need Help?</h3>
          <p>Our support team is here to help with your order.</p>
          <p><strong>(800) 555-0198</strong><br /><strong>support@medmkp.com</strong></p>
          <button className="secondary-action" type="button">Contact Support</button>
        </section>
      </aside>
    </div>
  );
}

function RecommendationSummary({ stats, total, savings, sourceCount, onReview }) {
  const hasSavings = savings > 0;
  const summaryCards = [
    { label: "items matched", value: stats.matchedItems },
    { label: "estimated savings", value: hasSavings ? money.format(savings) : "Best price" },
    { label: "recommendation confidence", value: `${stats.averageConfidence}%` },
    { label: "delivery estimate", value: stats.deliveryEstimate },
  ];

  return (
    <section className="recommendation-panel" aria-labelledby="recommendationHeading">
      <div className="recommendation-hero">
        <div>
          <p className="eyebrow">Recommendation Built</p>
          <h3 id="recommendationHeading">We found the best reorder path from {sourceCount} invoice source{sourceCount === 1 ? "" : "s"}.</h3>
          <p>
            MedMKP matched your prior purchases, found better-value options where appropriate,
            and kept the items needing attention separate.
          </p>
        </div>
        <div className="recommendation-total">
          <span>Recommended total</span>
          <strong>{money.format(total)}</strong>
        </div>
      </div>

      <div className="recommendation-stats">
        {summaryCards.map((card) => (
          <div key={card.label}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </div>
        ))}
      </div>

      <div className="recommendation-path">
        <div>
          <strong>{stats.exactMatches}</strong>
          <span>exact product match{stats.exactMatches === 1 ? "" : "es"}</span>
        </div>
        <div>
          <strong>{stats.substitutions}</strong>
          <span>recommended lower-cost equivalent{stats.substitutions === 1 ? "" : "s"}</span>
        </div>
        <div>
          <strong>{stats.needsReview}</strong>
          <span>item{stats.needsReview === 1 ? "" : "s"} needing buyer decision</span>
        </div>
      </div>

      <div className="recommendation-actions">
        <button className="primary-action compact" type="button" onClick={onReview}>Review recommendation</button>
      </div>
    </section>
  );
}

function InvoiceSourcesModal({ docs, onClose, onRemove }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-panel invoice-sources-modal" role="dialog" aria-modal="true" aria-labelledby="invoiceSourcesHeading" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Invoice Sources</p>
            <h3 id="invoiceSourcesHeading">{docs.length} source{docs.length === 1 ? "" : "s"} feeding this draft order</h3>
          </div>
          <button className="icon-button" type="button" aria-label="Close invoice sources" onClick={onClose}>×</button>
        </div>
        <div className="uploaded-doc-summary">
          <strong>{docs.reduce((total, doc) => total + doc.itemCount, 0)}</strong>
          <span>matched lines across uploaded invoices</span>
        </div>
        <div className="uploaded-doc-list">
          {docs.map((doc) => (
            <article className="uploaded-doc" key={doc.id}>
              <Icon name="icon-file-text" className="button-icon" />
              <span>
                <strong>{doc.name}</strong>
                <small>{doc.itemCount} matched item{doc.itemCount === 1 ? "" : "s"}</small>
              </span>
              <button className="text-action" type="button" onClick={() => onRemove(doc.id)}>Remove</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DraftOrderReview({ items, activeItems, total, onBack, onApprove, onRemove, onQtyChange }) {
  return (
    <div className="draft-review">
      <div className="draft-review-main">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Matched Draft Order</p>
            <h3>{activeItems.length} items ready to review</h3>
          </div>
          <span>{money.format(total)}</span>
        </div>

        <div className="draft-items">
          {items.map((item) => (
            <article className={`draft-item ${item.included ? "" : "removed"}`} key={item.product}>
              <div>
                <div className="draft-item-title">
                  <strong>{item.product}</strong>
                  <span className={`status-chip ${recommendationClass(item.recommendation?.matchType)}`}>
                    {recommendationLabel(item.recommendation?.matchType)}
                  </span>
                </div>
                <span>{item.recommendation?.priorProductName || item.extractedFrom} → {item.recommendation?.recommendedProductName || item.product}</span>
                <small>{item.recommendation?.recommendationReason || item.selected.reason}</small>
                <em>{item.recommendation?.shippingEstimate || "2-4 days"} · {item.recommendation?.supplierReliability || "95% on-time"} · {item.recommendation?.qualitySignal || "Vetted product"}</em>
              </div>
              <div className="qty-control">
                <button type="button" disabled={!item.included} onClick={() => onQtyChange(item.product, item.draftQty - 1)} aria-label={`Decrease ${item.product} quantity`}>-</button>
                <input
                  aria-label={`${item.product} quantity`}
                  disabled={!item.included}
                  min="1"
                  type="number"
                  value={item.draftQty}
                  onChange={(event) => onQtyChange(item.product, event.target.value)}
                />
                <button type="button" disabled={!item.included} onClick={() => onQtyChange(item.product, item.draftQty + 1)} aria-label={`Increase ${item.product} quantity`}>+</button>
              </div>
              <strong>{item.included ? money.format(item.draftQty * item.selected.unitPrice) : "Removed"}</strong>
              <button className="text-action" type="button" disabled={!item.included} onClick={() => onRemove(item.product)}>Remove</button>
            </article>
          ))}
        </div>
      </div>

      <aside className="draft-review-side">
        <p className="eyebrow">Buyer Review</p>
        <h3>Customize only if needed</h3>
        <p>Quantities can be adjusted before MedMKP places the order. Removed items stay visible so the buyer can see what changed.</p>
        <div className="wizard-actions">
          <button className="secondary-action compact" type="button" onClick={onBack}>Back</button>
          <button className="primary-action compact" type="button" onClick={onApprove}>Continue</button>
        </div>
      </aside>
    </div>
  );
}

function DraftOrderConfirm({ activeItems, total, sourceCount, onBack, onSubmit, submitting }) {
  return (
    <div className="draft-confirm">
      <div>
        <p className="eyebrow">Submit Order</p>
        <h3>Order assembled from {sourceCount} invoice{sourceCount === 1 ? "" : "s"}</h3>
        <p>Review the final total, then submit this order to MedMKP for supplier fulfillment.</p>
      </div>
      <div className="draft-confirm-total">
        <span>{activeItems.length} active line item{activeItems.length === 1 ? "" : "s"}</span>
        <strong>{money.format(total)}</strong>
      </div>
      <div className="wizard-actions">
        <button className="secondary-action compact" type="button" onClick={onBack}>Back to review</button>
        <button className="primary-action compact" type="button" disabled={!activeItems.length || submitting} onClick={onSubmit}>
          {submitting ? "Submitting..." : "Submit order"}
        </button>
      </div>
    </div>
  );
}

function DraftOrderSubmitted({ activeItems, total, sourceCount, onStartOver }) {
  return (
    <div className="draft-submitted">
      <div className="submitted-mark">
        <Icon name="icon-clipboard" />
      </div>
      <div>
        <p className="eyebrow">Order Submitted</p>
        <h3>MedMKP is preparing this order for supplier fulfillment.</h3>
        <p>{activeItems.length} line item{activeItems.length === 1 ? "" : "s"} from {sourceCount} invoice source{sourceCount === 1 ? "" : "s"} have been submitted.</p>
      </div>
      <div className="submitted-summary">
        <div><span>Estimated total</span><strong>{money.format(total)}</strong></div>
        <div><span>Status</span><strong>Submitted</strong></div>
      </div>
      <button className="primary-action compact" type="button" onClick={onStartOver}>Start another order</button>
    </div>
  );
}

function ExtractedTable({ lineItems }) {
  return (
    <div className="table-wrap extracted-preview">
      <table>
        <thead>
          <tr>
            <th>Extracted Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Old Vendor</th>
            <th>Old Unit Price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item) => (
            <tr key={item.product}>
              <td><strong>{item.product}</strong><br /><span>{item.extractedFrom}</span></td>
              <td>{item.qty}</td>
              <td>{item.unit}</td>
              <td>{item.oldVendor}</td>
              <td>{money.format(item.oldUnitPrice)}</td>
              <td><span className={`status-chip ${statusClass(item.status)}`}>{item.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
