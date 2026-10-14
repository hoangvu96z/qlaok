export interface VietnamProvince {
  code: string;
  name: string;
  region: 'Bắc Bộ' | 'Trung Bộ & Tây Nguyên' | 'Nam Bộ';
  mergedNote?: string;
}

/**
 * Danh sách chuẩn 34 Tỉnh / Thành phố trực thuộc Trung ương của Việt Nam
 * (6 Thành phố trực thuộc Trung ương & 28 Tỉnh)
 */
export const VIETNAM_PROVINCES_34: VietnamProvince[] = [
  // 6 Thành phố trực thuộc Trung ương (Ưu tiên hiển thị đầu hoặc theo vùng)
  { code: 'ha-noi', name: 'Hà Nội', region: 'Bắc Bộ' },
  {
    code: 'tp-ho-chi-minh',
    name: 'TP. Hồ Chí Minh',
    region: 'Nam Bộ',
    mergedNote: 'TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu',
  },
  {
    code: 'da-nang',
    name: 'Đà Nẵng',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Đà Nẵng, Quảng Nam',
  },
  {
    code: 'hai-phong',
    name: 'Hải Phòng',
    region: 'Bắc Bộ',
    mergedNote: 'Hải Phòng, Hải Dương',
  },
  {
    code: 'can-tho',
    name: 'Cần Thơ',
    region: 'Nam Bộ',
    mergedNote: 'Cần Thơ, Sóc Trăng, Hậu Giang',
  },
  { code: 'hue', name: 'Huế', region: 'Trung Bộ & Tây Nguyên' },

  // Bắc Bộ
  { code: 'quang-ninh', name: 'Quảng Ninh', region: 'Bắc Bộ' },
  {
    code: 'bac-ninh',
    name: 'Bắc Ninh',
    region: 'Bắc Bộ',
    mergedNote: 'Bắc Ninh, Bắc Giang',
  },
  {
    code: 'hung-yen',
    name: 'Hưng Yên',
    region: 'Bắc Bộ',
    mergedNote: 'Hưng Yên, Thái Bình',
  },
  {
    code: 'ninh-binh',
    name: 'Ninh Bình',
    region: 'Bắc Bộ',
    mergedNote: 'Ninh Bình, Hà Nam, Nam Định',
  },
  {
    code: 'phu-tho',
    name: 'Phú Thọ',
    region: 'Bắc Bộ',
    mergedNote: 'Phú Thọ, Vĩnh Phúc, Hòa Bình',
  },
  {
    code: 'thai-nguyen',
    name: 'Thái Nguyên',
    region: 'Bắc Bộ',
    mergedNote: 'Thái Nguyên, Bắc Kạn',
  },
  {
    code: 'lao-cai',
    name: 'Lào Cai',
    region: 'Bắc Bộ',
    mergedNote: 'Lào Cai, Yên Bái',
  },
  {
    code: 'tuyen-quang',
    name: 'Tuyên Quang',
    region: 'Bắc Bộ',
    mergedNote: 'Tuyên Quang, Hà Giang',
  },
  { code: 'lang-son', name: 'Lạng Sơn', region: 'Bắc Bộ' },
  { code: 'cao-bang', name: 'Cao Bằng', region: 'Bắc Bộ' },
  { code: 'son-la', name: 'Sơn La', region: 'Bắc Bộ' },
  { code: 'dien-bien', name: 'Điện Biên', region: 'Bắc Bộ' },
  { code: 'lai-chau', name: 'Lai Châu', region: 'Bắc Bộ' },

  // Trung Bộ & Tây Nguyên
  { code: 'thanh-hoa', name: 'Thanh Hóa', region: 'Trung Bộ & Tây Nguyên' },
  { code: 'nghe-an', name: 'Nghệ An', region: 'Trung Bộ & Tây Nguyên' },
  { code: 'ha-tinh', name: 'Hà Tĩnh', region: 'Trung Bộ & Tây Nguyên' },
  {
    code: 'quang-tri',
    name: 'Quảng Trị',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Quảng Trị, Quảng Bình',
  },
  {
    code: 'quang-ngai',
    name: 'Quảng Ngãi',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Quảng Ngãi, Kon Tum',
  },
  {
    code: 'gia-lai',
    name: 'Gia Lai',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Gia Lai, Bình Định',
  },
  {
    code: 'dak-lak',
    name: 'Đắk Lắk',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Đắk Lắk, Phú Yên',
  },
  {
    code: 'khanh-hoa',
    name: 'Khánh Hòa',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Khánh Hòa, Ninh Thuận',
  },
  {
    code: 'lam-dong',
    name: 'Lâm Đồng',
    region: 'Trung Bộ & Tây Nguyên',
    mergedNote: 'Lâm Đồng, Đắk Nông, Bình Thuận',
  },

  // Nam Bộ
  {
    code: 'dong-nai',
    name: 'Đồng Nai',
    region: 'Nam Bộ',
    mergedNote: 'Đồng Nai, Bình Phước',
  },
  {
    code: 'tay-ninh',
    name: 'Tây Ninh',
    region: 'Nam Bộ',
    mergedNote: 'Tây Ninh, Long An',
  },
  {
    code: 'dong-thap',
    name: 'Đồng Tháp',
    region: 'Nam Bộ',
    mergedNote: 'Đồng Tháp, Tiền Giang',
  },
  {
    code: 'vinh-long',
    name: 'Vĩnh Long',
    region: 'Nam Bộ',
    mergedNote: 'Vĩnh Long, Bến Tre, Trà Vinh',
  },
  {
    code: 'an-giang',
    name: 'An Giang',
    region: 'Nam Bộ',
    mergedNote: 'An Giang, Kiên Giang',
  },
  {
    code: 'ca-mau',
    name: 'Cà Mau',
    region: 'Nam Bộ',
    mergedNote: 'Cà Mau, Bạc Liêu',
  },
];
