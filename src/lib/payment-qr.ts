import type { Shop, ShopPaymentConfig } from '@/types/qlaok';

export interface VietQrBankOption {
  code: string;
  shortName: string;
  fullName: string;
  bin: string;
}

export const VIETQR_BANKS: VietQrBankOption[] = [
  {
    code: 'VCB',
    shortName: 'Vietcombank',
    fullName: 'Vietcombank - Ngân hàng Ngoại thương Việt Nam',
    bin: '970436',
  },
  {
    code: 'MB',
    shortName: 'MB Bank',
    fullName: 'MB Bank - Ngân hàng Quân Đội',
    bin: '970422',
  },
  {
    code: 'TCB',
    shortName: 'Techcombank',
    fullName: 'Techcombank - Ngân hàng Kỹ Thương',
    bin: '970407',
  },
  {
    code: 'ACB',
    shortName: 'ACB',
    fullName: 'ACB - Ngân hàng Á Châu',
    bin: '970416',
  },
  {
    code: 'BIDV',
    shortName: 'BIDV',
    fullName: 'BIDV - Ngân hàng Đầu tư & Phát triển VN',
    bin: '970418',
  },
  {
    code: 'ICB',
    shortName: 'VietinBank',
    fullName: 'VietinBank - Ngân hàng Công Thương VN',
    bin: '970415',
  },
  {
    code: 'VPB',
    shortName: 'VPBank',
    fullName: 'VPBank - Ngân hàng Việt Nam Thịnh Vượng',
    bin: '970432',
  },
  {
    code: 'TPB',
    shortName: 'TPBank',
    fullName: 'TPBank - Ngân hàng Tiên Phong',
    bin: '970423',
  },
  {
    code: 'STB',
    shortName: 'Sacombank',
    fullName: 'Sacombank - Ngân hàng Sài Gòn Thương Tín',
    bin: '970403',
  },
  {
    code: 'VBA',
    shortName: 'Agribank',
    fullName: 'Agribank - Ngân hàng NN & PTNT Việt Nam',
    bin: '970405',
  },
  {
    code: 'HDB',
    shortName: 'HDBank',
    fullName: 'HDBank - Ngân hàng Phát triển TP.HCM',
    bin: '970437',
  },
  {
    code: 'VIB',
    shortName: 'VIB',
    fullName: 'VIB - Ngân hàng Quốc Tế',
    bin: '970441',
  },
  {
    code: 'MSB',
    shortName: 'MSB',
    fullName: 'MSB - Ngân hàng Hàng Hải Việt Nam',
    bin: '970426',
  },
  {
    code: 'SHB',
    shortName: 'SHB',
    fullName: 'SHB - Ngân hàng Sài Gòn - Hà Nội',
    bin: '970443',
  },
  {
    code: 'OCB',
    shortName: 'OCB',
    fullName: 'OCB - Ngân hàng Phương Đông',
    bin: '970448',
  },
  {
    code: 'LPB',
    shortName: 'LPBank',
    fullName: 'LPBank - Ngân hàng Lộc Phát Việt Nam',
    bin: '970449',
  },
  {
    code: 'SEAB',
    shortName: 'SeABank',
    fullName: 'SeABank - Ngân hàng Đông Nam Á',
    bin: '970440',
  },
  {
    code: 'EIB',
    shortName: 'Eximbank',
    fullName: 'Eximbank - Ngân hàng Xuất Nhập Khẩu',
    bin: '970431',
  },
  {
    code: 'CAKE',
    shortName: 'CAKE by VPBank',
    fullName: 'CAKE by VPBank - Ngân hàng số',
    bin: '546034',
  },
  {
    code: 'TIMO',
    shortName: 'Timo',
    fullName: 'Timo by Ban Viet Bank',
    bin: '963388',
  },
];

export function stripVietnameseAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export interface ResolvedShopPaymentQr {
  qrImageUrl: string;
  isConfigured: boolean;
  mode: 'vietqr_auto' | 'custom_qr';
  bankId: string;
  bankShortName: string;
  bankFullName: string;
  accountNumber: string;
  accountName: string;
  transferContent: string;
  paymentNote: string;
}

export function getShopPaymentQrInfo(
  shop?: Shop | null,
  amount = 0,
  orderCode = '',
  overrideConfig?: ShopPaymentConfig
): ResolvedShopPaymentQr {
  const cfg = overrideConfig || shop?.theme_config?.paymentConfig;
  const mobileQr = shop?.theme_config?.paymentQr;

  const mode = cfg?.mode || 'vietqr_auto';
  const rawBankId = (
    cfg?.bankId ||
    mobileQr?.bankId ||
    mobileQr?.bankBin ||
    mobileQr?.bankShortName ||
    ''
  )
    .trim()
    .toUpperCase();
  const bankObj =
    VIETQR_BANKS.find(
      (b) =>
        b.code === rawBankId ||
        b.bin === rawBankId ||
        b.shortName.toUpperCase() === rawBankId
    );

  const rawAccountNo = (
    cfg?.accountNumber ||
    cfg?.accountNo ||
    mobileQr?.accountNumber ||
    mobileQr?.accountNo ||
    ''
  )
    .replace(/\s+/g, '')
    .trim();
  const defaultAccountName = stripVietnameseAccents(
    shop?.name || 'CHU QUAN QLAOK'
  );
  const rawConfiguredName = (
    cfg?.accountName ||
    mobileQr?.accountName ||
    ''
  ).trim();
  const accountName = rawConfiguredName
    ? stripVietnameseAccents(rawConfiguredName)
    : defaultAccountName;

  const prefix = (cfg?.transferPrefix || 'QLAOK').trim() || 'QLAOK';
  const transferContent = orderCode
    ? `${prefix} ${orderCode}`.trim()
    : `${prefix} THANH TOAN`;

  const template = cfg?.template || 'compact2';
  const paymentNote = (cfg?.paymentNote || '').trim();

  // Mode B: Custom uploaded or pasted QR image
  if (mode === 'custom_qr' && cfg?.customQrUrl?.trim()) {
    return {
      qrImageUrl: cfg.customQrUrl.trim(),
      isConfigured: true,
      mode: 'custom_qr',
      bankId: bankObj?.code || '',
      bankShortName: cfg?.bankName || bankObj?.shortName || '',
      bankFullName: cfg?.bankName || bankObj?.fullName || '',
      accountNumber: rawAccountNo,
      accountName,
      transferContent,
      paymentNote,
    };
  }

  // Mode A: Auto-generate dynamic VietQR from shop's configured bank account
  if (rawAccountNo && bankObj) {
    const cleanAmount = Math.max(0, Math.round(amount || 0));
    const amountParam = cleanAmount > 0 ? `amount=${cleanAmount}&` : '';
    const qrImageUrl = `https://img.vietqr.io/image/${encodeURIComponent(
      bankObj.code
    )}-${encodeURIComponent(
      rawAccountNo
    )}-${template}.png?${amountParam}addInfo=${encodeURIComponent(
      transferContent
    )}&accountName=${encodeURIComponent(accountName)}`;

    return {
      qrImageUrl,
      isConfigured: true,
      mode: 'vietqr_auto',
      bankId: bankObj.code,
      bankShortName: bankObj.shortName,
      bankFullName: bankObj.fullName,
      accountNumber: rawAccountNo,
      accountName,
      transferContent,
      paymentNote,
    };
  }

  // Unconfigured: NEVER return a fake/demo bank account QR
  return {
    qrImageUrl: '',
    isConfigured: false,
    mode: 'vietqr_auto',
    bankId: '',
    bankShortName: 'Chưa cấu hình ngân hàng',
    bankFullName: 'Cửa hàng chưa cấu hình tài khoản ngân hàng nhận tiền',
    accountNumber: '',
    accountName: '',
    transferContent,
    paymentNote,
  };
}
