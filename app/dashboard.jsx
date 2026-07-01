"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { traceApi, traceErrorMessage } from "./lib";
import s from "./dashboard.module.css";

// The overview surface a practice lands on first: at-a-glance stats, the items
// that need attention, recent activity, and the handful of actions most people
// start their day with. `DashboardView` is presentational — it renders standalone
// off the MOCK below. `OverviewRoute` at the bottom is the wired container: it
// pulls the practice's real /api/locations feed and derives the whole surface
// from it (see `buildDashboardData`).

const MOCK = {
  practiceName: "Bright Smiles Dental",
  stats: { locations: 7, items: 169, needsAttention: 11, auditReadiness: 86, potentialSavings: 1248.35 },
  needsAttention: [
    { id: 1, name: "Nitrile Exam Gloves, M", location: "Hygiene Cabinet", issue: "Expiring soon" },
    { id: 2, name: "CaviWipes Disinfectant", location: "Sterilization", issue: "Below par" },
    { id: 3, name: "Prophy Angles, Soft", location: "Operatory 1", issue: "Missing lot" },
  ],
  activity: [
    { id: 1, text: "Hygiene Cabinet scan completed — 37 items", time: "2h ago" },
    { id: 2, text: "Operatory 2 — 3 items added", time: "5h ago" },
    { id: 3, text: "SDS linked to CaviWipes Disinfectant", time: "Yesterday" },
  ],
};

// A circular progress ring for the audit-readiness percentage. SVG-only, no deps.
function AuditRing({ pct }) {
  const value = Math.max(0, Math.min(100, pct));
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  return (
    <span className={s.ringWrap}>
      <svg className={s.ring} viewBox="0 0 38 38" aria-hidden="true">
        <circle className={s.ringTrack} cx="19" cy="19" r={radius} />
        <circle
          className={s.ringFill}
          cx="19"
          cy="19"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={s.ringPct}>{value}%</span>
    </span>
  );
}

function Stat({ icon, label, value, alert, ring }) {
  return (
    <div className={`${s.stat} ${alert ? s.alert : ""}`}>
      {ring != null ? (
        <AuditRing pct={ring} />
      ) : (
        <span className={s.statIcon}><Icon name={icon} /></span>
      )}
      <div className={s.statBody}>
        <span className={s.statLabel}>{label}</span>
        <strong className={s.statValue}>{value}</strong>
      </div>
    </div>
  );
}

export function DashboardView({ data = MOCK, onStartScan, onAddLocation, onViewSavings, onViewNeedsAttention }) {
  const { practiceName, stats, needsAttention = [], activity = [] } = data;

  return (
    <div className={s.dash}>
      <header className={s.head}>
        <span className={s.eyebrow}>Overview</span>
        <h1 className={s.title}>Welcome back, {practiceName}</h1>
        <p className={s.subtitle}>Here&rsquo;s where your inventory and compliance stand today.</p>
      </header>

      <div className={s.stats}>
        <Stat icon="icon-map-pin" label="Locations" value={stats.locations} />
        <Stat icon="icon-package" label="Items tracked" value={stats.items} />
        <Stat
          icon="icon-alert-triangle"
          label="Needs attention"
          value={stats.needsAttention}
          alert={stats.needsAttention > 0}
        />
        {stats.auditReadiness != null && (
          <Stat label="Audit readiness" value="" ring={stats.auditReadiness} />
        )}
      </div>

      <div className={s.grid}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>
              <Icon name="icon-alert-triangle" />
              Needs attention
            </span>
            <button type="button" className={s.viewAll} onClick={() => onViewNeedsAttention?.()}>
              View all
              <Icon name="icon-arrow-right" />
            </button>
          </div>
          {needsAttention.length === 0 ? (
            <p className={s.empty}>Nothing needs attention right now.</p>
          ) : (
            <div className={s.naList}>
              {needsAttention.map((item) => (
                <div className={s.naRow} key={item.id}>
                  <span className={s.naDot}><Icon name="icon-alert-triangle" /></span>
                  <span className={s.naInfo}>
                    <span className={s.naName}>{item.name}</span>
                    <span className={s.naLoc}>{item.location}</span>
                  </span>
                  <span className={s.naIssue}>{item.issue}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={s.card}>
          <div className={s.cardHead}>
            <span className={s.cardTitle}>
              <Icon name="icon-clock" />
              Recent activity
            </span>
          </div>
          {activity.length === 0 ? (
            <p className={s.empty}>No recent activity yet.</p>
          ) : (
            <div className={s.feed}>
              {activity.map((event) => (
                <div className={s.feedRow} key={event.id}>
                  <span className={s.feedDot}><Icon name="icon-check-circle" /></span>
                  <span className={s.feedInfo}>
                    <span className={s.feedText}>{event.text}</span>
                    <span className={s.feedTime}>{event.time}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className={s.actions}>
        <button type="button" className={`${s.action} ${s.actionPrimary}`} onClick={() => onStartScan?.()}>
          <Icon name="icon-scan" />
          Start scan
        </button>
        <button type="button" className={s.action} onClick={() => onAddLocation?.()}>
          <Icon name="icon-plus" />
          Add location
        </button>
        <button type="button" className={s.action} onClick={() => onViewSavings?.()}>
          <Icon name="icon-dollar-circle" />
          View savings
        </button>
      </div>
    </div>
  );
}

// Human labels for the location `type` enum the backend stores, used to caption
// the needs-attention preview rows.
const LOCATION_TYPE_LABELS = {
  operatory: "Operatory",
  cabinet: "Cabinet",
  sterilization: "Sterilization",
  lab: "Lab",
  storage: "Storage",
  emergency_kit: "Emergency kit",
  other: "Location",
};

// "2 hr ago" style stamp for the activity feed (local copy — the Locations board
// has its own; nothing shared to import).
function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Derive the whole dashboard from the practice's real locations feed
// (/api/locations). Each location carries item_count, needs_attention_count and
// last_scanned_at, so the stats, the needs-attention preview and the activity
// feed all come from the same signal the Locations board uses — no fabricated
// numbers. Potential savings has no clean per-practice source yet, so that card
// is dropped rather than faked; audit readiness is computed from the real
// attention signal (see below).
export function buildDashboardData(practiceName, locations) {
  const items = locations.reduce((n, l) => n + (l.item_count || 0), 0);
  const needsAttentionCount = locations.reduce((n, l) => n + (l.needs_attention_count || 0), 0);

  const needsAttention = locations
    .filter((l) => (l.needs_attention_count || 0) > 0)
    .sort((a, b) => (b.needs_attention_count || 0) - (a.needs_attention_count || 0))
    .slice(0, 4)
    .map((l) => ({
      id: l.id,
      name: l.name,
      location: LOCATION_TYPE_LABELS[l.type] || LOCATION_TYPE_LABELS.other,
      issue: `${l.needs_attention_count} need${l.needs_attention_count === 1 ? "s" : ""} attention`,
    }));

  const activity = locations
    .filter((l) => l.last_scanned_at)
    .sort((a, b) => new Date(b.last_scanned_at) - new Date(a.last_scanned_at))
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      text: `${l.name} scanned — ${l.item_count || 0} item${(l.item_count || 0) === 1 ? "" : "s"}`,
      time: relativeTime(l.last_scanned_at),
    }));

  return {
    practiceName: practiceName || "your practice",
    stats: {
      locations: locations.length,
      items,
      needsAttention: needsAttentionCount,
      // Audit readiness = the share of tracked lots that are fully traceable and
      // not expired — i.e. NOT flagged for attention (attention = unidentified,
      // expired, expiring soon, or missing lot/expiry). Null when nothing's
      // tracked yet, which hides the ring rather than showing a hollow 0%.
      auditReadiness: items > 0 ? Math.round(((items - needsAttentionCount) / items) * 100) : null,
    },
    needsAttention,
    activity,
  };
}

// Wired container: loads the practice's locations and renders DashboardView off
// real data. `practiceName` comes from the app shell (already fetched via
// /api/auth/me), so this only needs the one locations call.
export function OverviewRoute({ practiceName, onStartScan, onNavigate }) {
  const [locations, setLocations] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let alive = true;
    traceApi.listLocations()
      .then((res) => {
        if (!alive) return;
        setLocations(res.locations || []);
        setLoadError("");
      })
      .catch((err) => {
        if (!alive) return;
        setLocations([]);
        setLoadError(traceErrorMessage(err, "Couldn't load your dashboard."));
      });
    return () => { alive = false; };
  }, []);

  if (locations === null) {
    return <div className={s.dash}><p className={s.empty}>Loading your dashboard…</p></div>;
  }
  if (loadError) {
    return <div className={s.dash}><p className={s.empty}>{loadError}</p></div>;
  }

  return (
    <DashboardView
      data={buildDashboardData(practiceName, locations)}
      onStartScan={onStartScan}
      onAddLocation={() => onNavigate?.("/app/locations/new")}
      onViewSavings={() => onNavigate?.("/app/savings")}
      onViewNeedsAttention={() => onNavigate?.("/app/needs-attention")}
    />
  );
}
