# Homepage copy review

Reviewed: 2026-10-20. Scope: `/`, Vietnamese and English. Shared auth, checkout, pricing rules and storefront copy remain unchanged.

## Findings and editorial changes

- Lead with everyday owner/guest needs, rather than internal labels such as ecosystem, Web POS, realtime or 3D. Hero: “Khách chọn món dễ hơn. Bạn nhẹ việc hơn.” / “Ordering feels easier. You have less to juggle.”
- Rewrite scene captions, six feature cards, video chapters, demo prompts, CTAs and footer in natural sentence case. Describe concrete actions: choose an item, identify its table, update availability, review sales.
- Remove unsupported promises: sub-200ms alerts, fixed AI processing times, automatic thermal printing, guaranteed perfect translations, missed-order guarantees and 24/7 support.
- Clarify that AI import needs merchant review and Premium; guest languages depend on enabled locales and plan limits.
- Replace fictitious Pro/chain pricing presentation with the actual Free/Basic/Premium tiers. Read amounts and numeric limits from PLAN_CONFIGS rather than duplicating business values.

Codex owns the wording and independent review. Actual Antigravity CLI owns scoped markup, responsive adjustments and keyboard-accessible disclosure controls on this page. No app-wide redesign.

## Verification

- CodeGraph: `explore "homepage landing page marketing copy HomePage"`, `query landing`, `node src/app/(marketing)/page.tsx` (including relevant ranges), `node src/lib/plan-limits.ts`, `node src/lib/plan-copy.ts`; AGY also inspected callers/affected areas and synced the index.
- Production `npm run build`: pass.
- Independent `npm run typecheck`: pass. Independent `npm run test:review`: 48 passed, 0 failed.
- Playwright on local preview: pricing mouse clicks for all three tiers; Free keyboard Enter/Space; feature disclosure; VI/EN switching with expanded selection retained; localized prices and language/item limits: pass.
- Responsive checks at 320, 390, 768, 1024 and 1440px: no horizontal page overflow. Desktop/mobile screenshots reviewed.
- AGY fixed header overflow, removed 3D effects from pricing cards that interfered with mouse hit testing, and clipped decorative horizontal overflow without changing the overall visual system.
- Scope: homepage presentation plus this review and README. No backend, database, plan entitlements, or shared checkout changes. Production deployment and external user testing are outside this verification.
