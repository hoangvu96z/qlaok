# Qlaok brand mark

Approved on 2026-10-20: concept 01, **Q + menu**. Preserve the emerald tile, dark Q ring, diagonal Q tail and three menu rows. The approved master is `public/brand/q-menu.svg`; `q-menu-mark.svg` is the transparent single-color mark for print.

## Application assets

- Web UI: shared `BrandLogo` component references `/brand/q-menu.svg`. Keep adjacent Qlaok text accessible; decorative logo images use empty alt. Standalone brand images need an accessible name. Merchant logos and avatar initials are separate identities.
- Browser favicon: `public/icon.svg`, identical to the approved master.
- PWA: 192px and 512px PNGs plus a separate 512px maskable image with full-bleed emerald background and a smaller centered mark for safe masking.
- Apple touch icon: full-bleed 180px PNG.
- Expo: `mobile/assets/q-menu.png` is a full-bleed opaque 1024px icon; `q-menu-adaptive.png` is the padded transparent adaptive foreground. Updating native launcher assets requires a new native build.

The PNGs are raster exports of the SVG geometry using the installed Sharp package, not separate drawings. Do not edit exported PNGs independently of the master.

## Historical exploration

`logo-exploration.html` and `logo-concepts.png` compare the three original proposals. Concepts 02 (open menu) and 03 (cutlery) are retained for reference; they are not application logos.

## Verification

CodeGraph: explore "Qlaok branding logo Q header login marketing dashboard"; node root layout and manifest; web/mobile agents inspect exact call sites with explore/node before edits. Application changes are limited to branding presentation and launcher metadata. No business behavior, permissions, prices, payment, or merchant identity changes.

Independent checks after integration:
- Web and mobile typecheck: pass. Web review tests: 48 passed; mobile tests: 18 passed. Production Next build: pass.
- Browser checks on homepage, pricing and login: approved image loaded with preserved square dimensions at 24/36/40/48px. Login checked at 390px in light and dark themes; no logo inversion or horizontal overflow.
- Favicon equals the master SVG; manifest references return HTTP 200. PNG dimensions validated; adaptive foreground checked to remain inside the padded central area.
- Service worker inspected through CodeGraph: network-first GET handling, no icon cache rewrite required.
- Not verified: authenticated dashboard/onboarding rendering with a real session; native simulator/device or store build. Their call sites were reviewed and typechecked. No commit, push, production deployment or native build performed.
