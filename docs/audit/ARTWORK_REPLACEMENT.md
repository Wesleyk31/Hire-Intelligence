# Homepage artwork replacement

Date: 2026-09-16 (Australia/Perth)

## Outcome and provenance

The homepage now uses six newly authored, self-contained SVG illustrations. These are replacement artwork, **not recovered copies of the previously approved homepage image**. No external image, font, script, or service is needed to render them.

The existing layout, typography, red/charcoal palette, feature text, breakpoints, and interactions are preserved. Feature illustrations remain CSS backgrounds on the existing `aria-hidden="true"` decorative elements; no meaningful information is available only in an image. The market trend is an illustrative graphic without factual labels or numeric claims.

## Original retained for traceability

`public/resources/approved-homepage.jpg` remains unchanged:

- Size: 5,128 bytes.
- SHA-256: `3cf611b65ccfd7b51c6d45a9727d8cf09f68d1464a2603ecf0959df526844645`.
- Surviving JPEG frame header declares 1491 × 1055 pixels, matching the original CSS.
- Pillow raises `UnidentifiedImageError`; the bytes have malformed header structure and no JPEG end marker.
- There are no active source references to this JPEG after the repair.

Bounded recovery checks covered the specified project, the original `Hire-Intelligence-Codex-Ready.zip`, and AppDeploy app `hirer-intelligence-mfj58p`:

- v1, v48, v75, and v80 inventories did not contain artwork.
- Reads of the asset in v81 and v82 returned `INVALID_ARGUMENT` because it was absent.
- v83, v84, v85, and v90 returned byte-identical copies of the corrupt local file.
- v87 and v96 inventories contain the same path; v96 corruption was already verified in the parent audit.
- v83 is the earliest containing snapshot: 15 September 2026, 11:21 AWST.
- The original handoff ZIP contains no JPEG, PNG, WebP, or SVG assets.
- The scoped local asset search found no alternate original.

No unrelated personal directories were searched.

## Replacement assets

| Asset under public/resources | Purpose | Intrinsic size |
| --- | --- | --- |
| project-signals.svg | Construction crane, foundations, and an early signal marker | 520 × 240 |
| shutdown-intelligence.svg | Industrial plant, maintenance valve, and clock | 520 × 240 |
| contractor-activity.svg | Site delivery team reviewing a plan | 520 × 240 |
| fleet-demand.svg | Excavator and haul truck | 520 × 240 |
| market-intelligence.svg | Industrial skyline and illustrative trend line | 520 × 240 |
| industrial-landscape.svg | Earthworks, conveyor, and equipment for the hero edge and CTA | 1260 × 500 |

Total new SVG payload: 15,347 bytes uncompressed.

`src/landing.css` now selects one SVG for each feature and uses `background-size: cover` and centered positioning. The hero edge and CTA share the industrial landscape with their existing overlays. The original screenshot crop percentages have been removed.

## Verification

- Before implementation, the existing browser regression `homepage feature artwork decodes as an actual image` failed with `loaded: false`.
- After implementation, the same regression passed: **1 passed, 0 failed**.
- Every SVG parses as XML, uses the SVG namespace, has positive intrinsic dimensions, and contains no external references, scripts, or foreign objects.
- Chrome decoded all seven background-image uses at both 1440 × 1000 and 375 × 812 viewport sizes: five feature images, the hero edge, and the CTA. The hero edge remains hidden at the existing mobile breakpoint, and its source was explicitly decoded by the check.
- Page width equalled viewport width at both sizes: no horizontal page overflow.
- No JavaScript page errors were observed.
- Full desktop and mobile screenshots were visually inspected. Illustrations remain clear at the existing crop sizes; the CTA overlay preserves text contrast.
- `git diff --check -- src/landing.css` passed.
- The original JPEG hash remains unchanged.

Local verification artifacts (ignored by Git):

- `.local/artwork-test-red/` and `.local/artwork-test-green/`
- `.local/artwork-review/desktop.png`
- `.local/artwork-review/mobile.png`
- `.local/artwork-review/desktop-features.png`
- `.local/artwork-review/mobile-features.png`
- `.local/artwork-review/checks.json`

The feature-only mobile screenshot includes the sticky navigation because the capture scrolls that element into view; the full-page mobile screenshot is the clean layout reference.

The screenshot preview used the verification runtime with synthetic summary data, port 4186, and its own dependency cache. An initial shared-cache preview returned Vite `Outdated Optimize Dep`; isolating the cache resolved it. These checks establish local asset rendering, not deployment or live runtime readiness. No commit or deployment was performed.
