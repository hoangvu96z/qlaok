import { StyleSheet } from 'react-native';
import { MobilePromoBannerConfig } from '../lib/supabase';

export type TabType =
  | 'orders'
  | 'overview'
  | 'catalog'
  | 'promotions'
  | 'settings';

export interface MobileThemePalette {
  bg: string;
  card: string;
  subCard: string;
  border: string;
  text: string;
  subText: string;
}

export const BRAND_COLOR_SWATCHES = [
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#ef4444',
  '#8b5cf6',
  '#0ea5e9',
  '#ec4899',
  '#92400e',
  '#1e293b',
];

export const BANNER_GRADIENT_SWATCHES: Array<{
  id: NonNullable<MobilePromoBannerConfig['bgGradient']>;
  hex: string;
}> = [
  { id: 'amber_rose', hex: '#f97316' },
  { id: 'emerald_teal', hex: '#0d9488' },
  { id: 'violet_fuchsia', hex: '#9333ea' },
  { id: 'royal_gold', hex: '#b45309' },
];

export const ALL_8_LANGS = [
  { code: 'vi', short: 'VN', flag: '🇻🇳' },
  { code: 'en', short: 'EN', flag: '🇬🇧' },
  { code: 'ko', short: 'KO', flag: '🇰🇷' },
  { code: 'ja', short: 'JA', flag: '🇯🇵' },
  { code: 'zh', short: 'ZH', flag: '🇨🇳' },
  { code: 'es', short: 'ES', flag: '🇪🇸' },
  { code: 'it', short: 'IT', flag: '🇮🇹' },
  { code: 'ru', short: 'RU', flag: '🇷🇺' },
];

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  authContainer: {
    flex: 1,
    backgroundColor: '#020617',
    justifyContent: 'center',
    padding: 20,
  },
  authCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  logoBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 24,
    fontWeight: '900',
    color: '#020617',
  },
  authTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },
  authSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
  },
  demoButton: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoButtonText: {
    color: '#020617',
    fontWeight: '900',
    fontSize: 12,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  authInput: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#ffffff',
    fontSize: 13,
  },
  primaryAuthBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryAuthBtnText: {
    color: '#020617',
    fontWeight: '900',
    fontSize: 13,
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  smallLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallLogoText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerSub: {
    fontSize: 11,
    color: '#64748b',
  },
  realtimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  realtimeDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  realtimeBadgeText: {
    fontSize: 9,
    fontWeight: '900',
  },
  themeToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  logoutBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  shopPillsRow: {
    flexDirection: 'row',
  },
  shopPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
  },
  shopPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  shopPillTextActive: {
    color: '#ffffff',
  },
  liveAlertBanner: {
    backgroundColor: '#0f172a',
    borderBottomWidth: 2,
    borderBottomColor: '#fbbf24',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveAlertBadge: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fbbf24',
  },
  liveAlertTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
  },
  liveAlertCta: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  liveAlertCtaText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#020617',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 12,
    color: '#64748b',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionStack: {
    gap: 14,
    paddingBottom: 28,
  },
  orderTicketCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  orderTicketNew: {
    borderColor: '#fbbf24',
    backgroundColor: '#fffbeb',
  },
  orderTicketPreparing: {
    borderColor: '#60a5fa',
  },
  orderHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderTableBadge: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
  },
  orderTotalText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#059669',
  },
  orderItemsBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  orderLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orderLineQty: {
    fontSize: 12,
    fontWeight: '900',
    color: '#059669',
    width: 26,
  },
  orderNoteText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b45309',
    marginTop: 2,
  },
  orderActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btnPrepare: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrepareText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  btnComplete: {
    flex: 1,
    backgroundColor: '#059669',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnCompleteText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  btnCancel: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnCancelText: {
    color: '#be123c',
    fontSize: 12,
    fontWeight: '800',
  },
  revenueHeroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 18,
  },
  revenueLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34d399',
    letterSpacing: 0.6,
  },
  revenueValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    marginVertical: 6,
  },
  revenueSub: {
    fontSize: 11,
    color: '#94a3b8',
  },
  chartBarsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    paddingTop: 12,
  },
  chartBarColumn: {
    flex: 1,
    alignItems: 'center',
  },
  chartBarTrack: {
    width: 22,
    height: 75,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  kpiCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  kpiNumber: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
  },
  kpiTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 2,
  },
  kpiHint: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  topItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rankBadge: {
    width: 28,
    fontSize: 12,
    fontWeight: '900',
    color: '#10b981',
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  itemSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  viewCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f766e',
  },
  quickAddRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: '#0f172a',
  },
  addBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginRight: 8,
  },
  catChipActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  catChipTextActive: {
    color: '#ffffff',
  },
  itemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemCardSoldOut: {
    opacity: 0.6,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  priceBadge: {
    fontSize: 13,
    fontWeight: '900',
    color: '#059669',
  },
  stockBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  priceStepBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priceStepText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  switchColumn: {
    alignItems: 'center',
    gap: 4,
  },
  stockStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 10,
    marginBottom: 4,
  },
  saveSettingsBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveSettingsBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  phoneViewerFrame: {
    borderRadius: 26,
    borderWidth: 4,
    overflow: 'hidden',
  },
  phoneViewerHeader: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  phoneViewerLogo: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langPreviewPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 6,
  },
  previewBannerBox: {
    borderRadius: 14,
    padding: 10,
  },
  previewFlashBox: {
    backgroundColor: '#e11d48',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  subTabBtn: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  choiceBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  choiceBtnActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  choiceBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  choiceBtnTextActive: {
    color: '#065f46',
  },
  miniChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  selectableItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  colorCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleActive: {
    borderWidth: 3,
    borderColor: '#0f172a',
  },
  bottomNav: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  navTabText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  navTabTextActive: {
    color: '#10b981',
    fontWeight: '800',
  },
});
