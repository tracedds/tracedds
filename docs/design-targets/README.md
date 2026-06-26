# Wireframes — Sean's product vision (design source of truth)

These are downscaled JPEGs of Sean's target screens, committed so eng-loop issues can
reference an exact visual target (see the "Visual fidelity" protocol in
`scripts/eng-loop/loop-prompt.md`). Match the wireframe's **layout / density / hierarchy**
rendered in **our tokens** (`styles.css` / `DESIGN.md`) — don't pixel-copy the raster (it
has placeholder text + loose grids).

The **full-res originals are committed in-repo at `wireframes/`** (`TraceDDS (New)/` +
`Updated Screen Frames/`) — they are the source of truth for all UI work (see the repo
root `CLAUDE.md`). The downscaled JPEGs in *this* dir are just lean copies of the frames a
specific issue references, for compact issue bodies; add more here per surface as issues
are created.

Captured current-state screenshots live in `current/` (the "before" baseline an issue's
worker compares against).

| File (committed) | Wireframe | Surface | Current view |
|---|---|---|---|
| `reorder-list.jpg` | 1 — Desktop Reorder List | Reorder | `app/reorder.jsx` |
| `reorder-drawer.jpg` | 1.1 — Reorder Product Drawer | Reorder drawer | `reorder.jsx` → `MatchPanel` |
| `reorder-forecast.jpg` | 1.3 — Forecast/Usage Settings Drawer | Reorder drawer (tabs) | `reorder.jsx` |
| `needs-attention.jpg` / `needs-attention-updated.jpg` | 2.1 + 6 — Needs Attention | Needs Attention | `app/needsattention.jsx` · `current/needs-attention-current.png` |
| `savings.jpg` | 14 — Savings Opportunities | Savings | `SavingsView` in `app/reorder.jsx` · `current/savings-current.png` |
| `evidence-library.jpg` | 15 — Evidence Library | Evidence | `app/evidence.jsx` · `current/evidence-current.png` |
| `evidence-upload.jpg` | 21 — Upload Evidence | Evidence intake | _greenfield_ |
| `evidence-match-review.jpg` | 22 — Evidence Match Review | Evidence matching | _greenfield_ |
| `evidence-redline.jpg` | 26 — Compliance Update Review (redline) | Evidence diff/approve | _greenfield_ |
| `evidence-viewer-mobile.jpg` | 24 — Evidence Viewer (mobile) | Evidence presentation | _greenfield_ |
| `office-layout.jpg` | 19 — Office layout | Locations floorplan | _greenfield_ |

### Full vision set
All full-res originals are committed under `wireframes/` (see repo-root `CLAUDE.md`). Surfaces:
Reorder (1, 1.1, 1.3) · Needs Attention (2.1, 6) · Mobile scan (3–10) · Locations + Office
(11, 12, 13, 19) · Savings (14) · **Compliance/Evidence (15, 16, 17, 20, 20.1, 21, 22, 23,
24, 26) — biggest gap** · QR labels (18).
