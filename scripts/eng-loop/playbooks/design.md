### Playbook: design polish (visual)

Goal: find ONE **visual/design** defect versus the live `/styleguide` + `DESIGN.md` —
spacing, alignment, hierarchy, off-token colors, AI-slop, overflow/clipping — and fix it,
verified with **before/after screenshots**. (Broken behavior belongs to the `qa` lane.)

#### 1. Bring up the app
- Your cwd is the worktree. `npm run dev` (background) on the RUN CONTEXT port; wait until it responds.
- Use `/browse`: `$B goto <url>`, `$B screenshot <path>`, `$B snapshot -a -o <path>` (annotated),
  `$B responsive <prefix>` (mobile/tablet/desktop), `$B css <sel> <prop>` (computed styles).

#### 2. Find one design defect
- Compare a screen against `/styleguide` + `DESIGN.md`. Look for: inconsistent
  spacing/radii/weights, misalignment, weak hierarchy, hardcoded colors off the tokens,
  overflow/clipping, or AI-slop (over-bordered, over-shadowed, generic). Check mobile too.
- Follow team prefs: lean/lighter font weights + smaller sizes; canonical tokens; the shared
  `ui.jsx`/`icons.jsx` components; new CSS as a module referencing global tokens (no hardcoded hex).
- Pick ONE clear, contained improvement. No broad restyles.

#### 3. Capture BEFORE
- `$B screenshot eng-loop-evidence/<stamp>/before.png` (annotate the issue with `snapshot -a`).
  Capture mobile if the issue is responsive.

#### 4. Fix it
- Minimal, token-correct change in the right CSS module / component. Match the style guide.

#### 5. Capture AFTER + verify
- Re-render and screenshot `.../after.png` (same viewport). Confirm the fix **and** no layout
  regression on desktop AND mobile.

#### 6. Open the PR
- Commit the evidence PNGs + the fix; push; `gh pr create` embedding before/after. Note which
  `/styleguide` rule/token it aligns to. No evidence → no PR.
