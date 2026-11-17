# CRAFT_RULES.md — SLOKern Frontend Craft Invariants

> **Status:** Active · Last revised: 2026-11-17  
> **Scope:** All files under `frontend/src/`  
> **Authority:** These rules supplement `../AGENTS.md` and `DESIGN.md`. On conflict, `../AGENTS.md` wins.

These five invariants exist because specific, visual defects were caught in production screenshots. Each rule names the class of problem it prevents, the rationale, and the enforcement pattern.

---

## RULE 1 — No Unconditional SVG Text Labels on Data Points

**Problem:** Rendering a `<text>` element above every data point in a scatter/trade-off chart causes catastrophic label collision when two or more candidates share similar coordinates. The labels merge into an unreadable mass.

**Rule:**
- SVG data-point labels **must not** render unconditionally for every point in a loop.
- Labels are allowed **only** for the currently selected / highlighted point.
- When shown, abbreviate the label to ≤ 8 characters (e.g. `c.id.slice(-6)`).
- Full identity information belongs in the **hover tooltip**, not on the chart canvas.

**Pattern (correct):**
```tsx
{isSelected && (
  <text x={cx} y={cy - 18} fontSize="10px" fontWeight={700} textAnchor="middle">
    {c.id.slice(-6)}
  </text>
)}
```

**Anti-pattern (forbidden):**
```tsx
{/* ❌ renders for every point regardless of selection state */}
<text ...>{c.id}</text>
```

---

## RULE 2 — No SVG `<text>` Content Longer Than 60 Characters

**Problem:** SVG text does not word-wrap. Strings that exceed the viewBox width silently clip or overflow outside the diagram boundary, breaking both aesthetics and legibility.

**Rule:**
- Every hardcoded SVG `<text>` string must be **≤ 60 characters** in source.
- Section/zone headers: use abbreviations (`ZONE 01 · SEARCH SWEEP & SELECTION`, not a full sentence).
- Column headers in data tables: use short nouns (`SEARCH`, `TOLERANCE`, `RERUN`, `VERDICT`).
- Footer attribution lines: combine related credits into one ≤ 60 char line.

**Guidance:**
- If a label needs more than ~6 words, break it into a title + subtitle pair at different `y` offsets or convert to an HTML overlay tooltip.
- Use `·` (middle dot U+00B7) as a compact separator between concepts.

---

## RULE 3 — No `//` in User-Facing UI Labels

**Problem:** `//` is a programmer comment convention. It reads as an error or unprocessed template to end users, and is visually aggressive in a technical dashboard context.

**Rule:**
- **Never** use `//` as a separator or section delimiter in any user-visible text: SVG labels, HTML headings, button labels, status messages, or badge text.
- Use `·` (middle dot) for inline separation: `ZONE 01 · SEARCH SWEEP & SELECTION`
- Use `—` (em dash) for contrast or range: `BEFORE — AFTER`
- Use `:` (colon) for key–value: `DEC-0014: Verification Isolation`

**Anti-pattern (forbidden):**
```tsx
// ❌ programmer syntax in a UI label
"ZONE 01 // SEARCH SWEEP & SELECTION"
"DRIFT COMPARATOR CHANNELS // GATE CORRIDOR CROSSING"
```

---

## RULE 4 — Absolutely Positioned Tooltips Must Be Quadrant-Aware

**Problem:** A tooltip always positioned `bottom: 8px, right: 8px` overflows the visible container when the trigger element is in the top-right quadrant. The tooltip renders outside the scrollable area or is clipped by `overflow: hidden`.

**Rule:**
- Any absolutely positioned tooltip or popover that is triggered by hovering over a **specific element** (not a fixed zone) must derive its position from the element's location within the container.
- For 2×2 or similar grid layouts, use a quadrant check:

```tsx
const isTopHalf    = candidate.batch > 1;        // adjust threshold to match grid
const isRightHalf  = candidate.concurrency > 16; // adjust threshold to match grid

// Flip to diagonally opposite quadrant to avoid occluding target card or headers:
const style = {
  position: 'absolute' as const,
  ...(isTopHalf   ? { bottom: '22px', top: 'unset' as const } : { top: '76px', bottom: 'unset' as const }),
  ...(isRightHalf ? { left: '24px',   right: 'unset' as const } : { right: '24px', left: 'unset' as const }),
};
```

- Never set both `left` and `right` simultaneously without explicitly unsetting the other via `'unset'`.
- For non-grid charts, derive position from the computed pixel coordinate: if `cx > plotWidth / 2` → anchor right; if `cy < plotHeight / 2` → anchor top.

---

## RULE 5 — Status Indicator Size Hierarchy Must Be Respected

**Problem:** Inconsistent badge sizing causes visual hierarchy breakdowns: a secondary metadata note (e.g. "reason code unavailable") renders as large and bright as a primary error; a simple pass confirmation expands into a full-width heavy block; a small state chip overwhelms the element it annotates.

**Rule:**
Indicators follow a strict three-tier hierarchy:

| Tier | Use | Max font size | Background fill | Border |
|---|---|---|---|---|
| **Micro-badge** | Secondary metadata, state tags on IDs | `11px` | Transparent | 1px solid, dimmed color |
| **Inline callout** | Constraint pass/fail in context, reason codes | `11px` mono | 8% opacity fill | 1px solid, 30% opacity |
| **Section banner** | Top-level errors, security alerts | `12–13px` | 12% opacity fill | Full-opacity border |

Specific invariants:
- A **"not available"** / "unavailable" / "pending" state must **never** be styled the same as an active error. Use `var(--text-muted)` color and no fill background.
- An `ACTIVE` or `WINNER` state chip on a candidate ID must be **micro-badge tier**: `fontSize: '10px', padding: '2px 7px', background: transparent, border: '1px solid var(--primary)', color: var(--primary-bright)`.
- A **"all constraints satisfied"** confirmation must be **inline callout tier** with a left-border accent (not a full-width filled block): `borderLeft: '2px solid var(--primary)', paddingLeft: '8px'`.
- A **breach / infeasible** warning may be **inline callout** or **section banner** depending on severity, but must never be rendered identically to a "satisfied" state.

---

## Applying These Rules

When adding or modifying any component:
1. **Chart labels?** → Check RULE 1: selection-gated only.
2. **SVG text?** → Check RULE 2: count the characters.
3. **Separators in labels?** → Check RULE 3: `·` or `—`, never `//`.
4. **Hover tooltip placement?** → Check RULE 4: quadrant-aware.
5. **Adding a badge or status indicator?** → Check RULE 5: which tier?

These rules are enforced by design review during PR, not by automated lint (yet). They are intentionally brief — the goal is fast pattern recognition, not exhaustive documentation.
