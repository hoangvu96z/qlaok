import type { I18nText, ItemOptionGroup } from '@/types/qlaok';

export interface OptionPresetTemplate {
  key: string;
  badge: string;
  label: string;
  createGroup: () => ItemOptionGroup;
}

const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const ITEM_OPTION_GROUP_PRESETS: OptionPresetTemplate[] = [
  {
    key: 'sugar_level',
    badge: '🍯 Độ ngọt / Đường',
    label: '+ Nhóm Mức Đường (Ít/Nhiều đường)',
    createGroup: () => ({
      id: uid('grp-sugar'),
      required: true,
      name_i18n: {
        vi: 'Mức đường (Độ ngọt)',
        en: 'Sugar / Sweetness Level',
        ko: '당도 선택',
        ja: '甘さの選択',
        zh: '甜度选择',
        es: 'Nivel de azúcar',
        it: 'Livello di dolcezza',
        ru: 'Уровень сладости',
      },
      desc_i18n: {
        vi: 'Chọn độ ngọt phù hợp khẩu vị của bạn',
        en: 'Choose your preferred sweetness level',
        ko: '취향에 맞는 당도를 선택하세요',
        ja: 'お好みの甘さをお選びください',
        zh: '请选择适合您口味的甜度',
      },
      choices: [
        {
          id: uid('ch-sugar-100'),
          extra_price: 0,
          label_i18n: {
            vi: '100% Đường (Ngọt chuẩn)',
            en: '100% Normal Sugar',
            ko: '기본 당도 (100%)',
            ja: '通常の甘さ (100%)',
            zh: '全糖 (100%)',
            es: '100% Azúcar normal',
            it: '100% Zucchero normale',
            ru: '100% Обычный сахар',
          },
          desc_i18n: {
            vi: 'Độ ngọt chuẩn công thức quán',
            en: 'Standard house recipe sweetness',
          },
        },
        {
          id: uid('ch-sugar-70'),
          extra_price: 0,
          label_i18n: {
            vi: 'Ít đường (70% - Khuyên dùng)',
            en: 'Less Sugar (70% - Recommended)',
            ko: '덜 달게 (70% 추천)',
            ja: '甘さ控えめ (70% おすすめ)',
            zh: '七分糖 (70% 推荐)',
            es: 'Menos azúcar (70%)',
            it: 'Meno zucchero (70%)',
            ru: 'Меньше сахара (70%)',
          },
          desc_i18n: {
            vi: 'Vị ngọt thanh nhẹ, tôn hương vị trà',
            en: 'Lightly sweet, highlights natural aroma',
          },
        },
        {
          id: uid('ch-sugar-50'),
          extra_price: 0,
          label_i18n: {
            vi: 'Nửa đường (50%)',
            en: 'Half Sugar (50%)',
            ko: '반당 (50%)',
            ja: '半分 (50%)',
            zh: '半糖 (50%)',
            es: 'Mitad de azúcar (50%)',
            it: 'Metà zucchero (50%)',
            ru: 'Половина сахара (50%)',
          },
        },
        {
          id: uid('ch-sugar-120'),
          extra_price: 0,
          label_i18n: {
            vi: 'Nhiều đường (120% - Ngọt đậm)',
            en: 'Extra Sugar (120%)',
            ko: '더 달게 (120%)',
            ja: '甘め (120%)',
            zh: '多糖 (120%)',
            es: 'Azúcar extra (120%)',
            it: 'Zucchero extra (120%)',
            ru: 'Больше сахара (120%)',
          },
        },
        {
          id: uid('ch-sugar-0'),
          extra_price: 0,
          label_i18n: {
            vi: 'Không đường (0%)',
            en: 'No Sugar (0%)',
            ko: '무설탕 (0%)',
            ja: '無糖 (0%)',
            zh: '无糖 (0%)',
            es: 'Sin azúcar (0%)',
            it: 'Senza zucchero (0%)',
            ru: 'Без сахара (0%)',
          },
        },
      ],
    }),
  },
  {
    key: 'ice_level',
    badge: '🧊 Mức đá',
    label: '+ Nhóm Mức Đá (Ít/Không đá)',
    createGroup: () => ({
      id: uid('grp-ice'),
      required: true,
      name_i18n: {
        vi: 'Mức đá',
        en: 'Ice Level',
        ko: '얼음 양',
        ja: '氷の量',
        zh: '冰量选择',
        es: 'Nivel de hielo',
        it: 'Livello di ghiaccio',
        ru: 'Количество льда',
      },
      desc_i18n: {
        vi: 'Chọn lượng đá hoặc để đá riêng',
        en: 'Select ice amount or separate ice',
      },
      choices: [
        {
          id: uid('ch-ice-100'),
          extra_price: 0,
          label_i18n: {
            vi: 'Đá bình thường (100%)',
            en: 'Normal Ice (100%)',
            ko: '기본 얼음 (100%)',
            ja: '通常の氷 (100%)',
            zh: '正常冰 (100%)',
            es: 'Hielo normal',
            it: 'Ghiaccio normale',
            ru: 'Обычный лед',
          },
        },
        {
          id: uid('ch-ice-50'),
          extra_price: 0,
          label_i18n: {
            vi: 'Ít đá (50%)',
            en: 'Less Ice (50%)',
            ko: '얼음 적게 (50%)',
            ja: '氷少なめ (50%)',
            zh: '少冰 (50%)',
            es: 'Poco hielo',
            it: 'Poco ghiaccio',
            ru: 'Мало льда',
          },
        },
        {
          id: uid('ch-ice-sep'),
          extra_price: 0,
          label_i18n: {
            vi: 'Đá để riêng (Mang về)',
            en: 'Separate Ice (Takeaway)',
            ko: '얼음 따로',
            ja: '氷別添え',
            zh: '冰块分开装',
            es: 'Hielo aparte',
            it: 'Ghiaccio a parte',
            ru: 'Лед отдельно',
          },
        },
        {
          id: uid('ch-ice-0'),
          extra_price: 0,
          label_i18n: {
            vi: 'Không đá',
            en: 'No Ice',
            ko: '얼음 없음',
            ja: '氷なし',
            zh: '去冰',
            es: 'Sin hielo',
            it: 'Senza ghiaccio',
            ru: 'Без льда',
          },
        },
      ],
    }),
  },
  {
    key: 'drink_size',
    badge: '🥤 Kích cỡ (Size)',
    label: '+ Nhóm Size (M / L +Giá)',
    createGroup: () => ({
      id: uid('grp-size'),
      required: true,
      name_i18n: {
        vi: 'Chọn Kích Cỡ (Size)',
        en: 'Choose Size',
        ko: '사이즈 선택',
        ja: 'サイズ選択',
        zh: '杯型大小',
        es: 'Tamaño',
        it: 'Dimensione',
        ru: 'Размер порции',
      },
      desc_i18n: {
        vi: 'Nâng cấp Size lớn hơn để thưởng thức trọn vẹn',
        en: 'Upgrade to Large size for more volume',
      },
      choices: [
        {
          id: uid('ch-size-m'),
          extra_price: 0,
          label_i18n: {
            vi: 'Size M (Tiêu chuẩn - 500ml)',
            en: 'Size M (Regular - 500ml)',
            ko: 'M 사이즈 (기본 500ml)',
            ja: 'Mサイズ (標準 500ml)',
            zh: '中杯 M (标准 500ml)',
            es: 'Tamaño M (Estándar)',
            it: 'Taglia M (Standard)',
            ru: 'Размер M (Стандарт)',
          },
        },
        {
          id: uid('ch-size-l'),
          extra_price: 10000,
          label_i18n: {
            vi: 'Size L (Lớn - 700ml)',
            en: 'Size L (Large - 700ml)',
            ko: 'L 사이즈 (대용량 700ml)',
            ja: 'Lサイズ (大 700ml)',
            zh: '大杯 L (700ml)',
            es: 'Tamaño L (Grande)',
            it: 'Taglia L (Grande)',
            ru: 'Размер L (Большой)',
          },
          desc_i18n: {
            vi: 'Tăng 40% dung tích đồ uống',
            en: '+40% more drink volume',
          },
        },
      ],
    }),
  },
  {
    key: 'drink_toppings',
    badge: '🧋 Topping Đồ Uống',
    label: '+ Nhóm Topping (Trân châu, Kem Cheese...)',
    createGroup: () => ({
      id: uid('grp-topping'),
      required: false,
      name_i18n: {
        vi: 'Topping thêm (Chọn nhiều)',
        en: 'Extra Toppings (Multi-select)',
        ko: '토핑 추가 (중복 선택 가능)',
        ja: 'トッピング追加 (複数選択可)',
        zh: '加料小料 (可多选)',
        es: 'Toppings extra',
        it: 'Topping extra',
        ru: 'Топпинги на выбор',
      },
      desc_i18n: {
        vi: 'Có thể chọn nhiều loại topping ăn kèm (tự động cộng giá)',
        en: 'Select as many toppings as you like',
      },
      choices: [
        {
          id: uid('ch-top-pearl'),
          extra_price: 10000,
          label_i18n: {
            vi: 'Trân châu đường đen dẻo dai',
            en: 'Brown Sugar Boba Pearls',
            ko: '흑당 타피오카 펄',
            ja: '黒糖タピオカパール',
            zh: '黑糖珍珠',
            es: 'Perlas de tapioca',
            it: 'Perle di tapioca',
            ru: 'Жемчужины тапиоки',
          },
          desc_i18n: {
            vi: 'Nấu mới mỗi 2 tiếng, mềm dẻo thơm mùi đường đen',
            en: 'Freshly cooked every 2 hours, chewy & aromatic',
          },
        },
        {
          id: uid('ch-top-whitepearl'),
          extra_price: 10000,
          label_i18n: {
            vi: 'Trân châu trắng giòn sần sật',
            en: 'Crispy White Crystal Boba',
            ko: '화이트 크리스탈 펄',
            ja: 'ホワイトクリスタルボバ',
            zh: '脆波波/寒天晶球',
            es: 'Boba cristal blanco',
            it: 'Boba di cristallo',
            ru: 'Белая хрустящая боба',
          },
        },
        {
          id: uid('ch-top-cheese'),
          extra_price: 15000,
          label_i18n: {
            vi: 'Lớp Kem Cheese Macchiato béo mặn',
            en: 'Savory Cream Cheese Foam',
            ko: '크림치즈 폼 추가',
            ja: '濃厚チーズフォーム',
            zh: '咸香芝士奶盖',
            es: 'Espuma de queso crema',
            it: 'Crema al formaggio',
            ru: 'Сырная пенка макиато',
          },
          desc_i18n: {
            vi: 'Kem phô mai đánh bông béo ngậy',
            en: 'Rich whipped cream cheese topping',
          },
        },
        {
          id: uid('ch-top-jelly'),
          extra_price: 10000,
          label_i18n: {
            vi: 'Thạch đào / Thạch trái cây tươi',
            en: 'Peach & Fruit Jelly',
            ko: '복숭아 과일 젤리',
            ja: 'ピーチ＆フルーツゼリー',
            zh: '蜜桃果冻',
            es: 'Gelatina de melocotón',
            it: 'Gelatina alla pesca',
            ru: 'Персиковое желе',
          },
        },
      ],
    }),
  },
  {
    key: 'food_addons',
    badge: '🥩 Gọi thêm Món Ăn',
    label: '+ Nhóm Gọi Thêm (Thịt, Trứng, Quẩy...)',
    createGroup: () => ({
      id: uid('grp-food-addon'),
      required: false,
      name_i18n: {
        vi: 'Gọi thêm / Topping món ăn',
        en: 'Extra Add-ons & Sides',
        ko: '사이드 및 토핑 추가',
        ja: '追加トッピング・サイド',
        zh: '加菜 / 额外配料',
        es: 'Extras y acompañamientos',
        it: 'Extra e contorni',
        ru: 'Добавки к блюду',
      },
      desc_i18n: {
        vi: 'Chọn thêm phần ăn kèm theo sở thích',
        en: 'Customize your dish with extra portions',
      },
      choices: [
        {
          id: uid('ch-food-meat'),
          extra_price: 25000,
          label_i18n: {
            vi: 'Thêm phần thịt đặc biệt',
            en: 'Extra Sliced Meat Portion',
            ko: '고기 추가',
            ja: 'お肉大盛り追加',
            zh: '加肉份量',
            es: 'Porción extra de carne',
            it: 'Porzione extra di carne',
            ru: 'Дополнительная порция мяса',
          },
        },
        {
          id: uid('ch-food-egg'),
          extra_price: 10000,
          label_i18n: {
            vi: 'Thêm trứng (Trứng chần / Ốp la)',
            en: 'Extra Egg (Poached / Sunny-side up)',
            ko: '계란 추가 (수란/프라이)',
            ja: '卵追加 (半熟卵・目玉焼き)',
            zh: '加鸡蛋 (水波蛋/煎蛋)',
            es: 'Huevo extra',
            it: 'Uovo extra',
            ru: 'Дополнительное яйцо',
          },
        },
        {
          id: uid('ch-food-noodle'),
          extra_price: 10000,
          label_i18n: {
            vi: 'Thêm bún / phở / mì / cơm',
            en: 'Extra Noodles / Steamed Rice',
            ko: '면 / 밥 추가',
            ja: '麺・ライス追加',
            zh: '加粉 / 加面 / 加饭',
            es: 'Fideos / Arroz extra',
            it: 'Spaghetti / Riso extra',
            ru: 'Доп. лапша / рис',
          },
        },
      ],
    }),
  },
];

const QUICK_OPTION_DICTIONARY: Array<{
  match: RegExp;
  i18n: Omit<I18nText, 'vi'>;
}> = [
  {
    match: /^ít đường|70% đường/i,
    i18n: {
      en: 'Less Sugar (70%)',
      ko: '덜 달게 (70%)',
      ja: '甘さ控えめ (70%)',
      zh: '少糖 (70%)',
      es: 'Menos azúcar',
      it: 'Meno zucchero',
      ru: 'Меньше сахара',
    },
  },
  {
    match: /^nhiều đường|120% đường/i,
    i18n: {
      en: 'Extra Sugar',
      ko: '더 달게',
      ja: '甘め',
      zh: '多糖',
      es: 'Azúcar extra',
      it: 'Zucchero extra',
      ru: 'Больше сахара',
    },
  },
  {
    match: /^không đường|0% đường/i,
    i18n: {
      en: 'No Sugar (0%)',
      ko: '무설탕 (0%)',
      ja: '無糖 (0%)',
      zh: '无糖 (0%)',
      es: 'Sin azúcar',
      it: 'Senza zucchero',
      ru: 'Без сахара',
    },
  },
  {
    match: /^ít đá/i,
    i18n: {
      en: 'Less Ice',
      ko: '얼음 적게',
      ja: '氷少なめ',
      zh: '少冰',
      es: 'Poco hielo',
      it: 'Poco ghiaccio',
      ru: 'Мало льда',
    },
  },
  {
    match: /^không đá/i,
    i18n: {
      en: 'No Ice',
      ko: '얼음 없음',
      ja: '氷なし',
      zh: '去冰',
      es: 'Sin hielo',
      it: 'Senza ghiaccio',
      ru: 'Без льда',
    },
  },
  {
    match: /trân châu/i,
    i18n: {
      en: 'Boba Pearls',
      ko: '타피오카 펄',
      ja: 'タピオカパール',
      zh: '珍珠',
      es: 'Perlas de tapioca',
      it: 'Perle di tapioca',
      ru: 'Тапиока боба',
    },
  },
  {
    match: /kem cheese|phô mai/i,
    i18n: {
      en: 'Cream Cheese Foam',
      ko: '크림치즈 폼',
      ja: 'チーズフォーム',
      zh: '芝士奶盖',
      es: 'Espuma de queso',
      it: 'Crema al formaggio',
      ru: 'Сырная пенка',
    },
  },
];

function fillMissingOptionI18n(src?: I18nText): I18nText {
  if (!src) return { vi: '' };
  const vi = (src.vi || '').trim();
  if (!vi) return src;
  const matched = QUICK_OPTION_DICTIONARY.find((d) => d.match.test(vi));
  return {
    vi,
    en: src.en?.trim() || matched?.i18n.en || vi,
    ko: src.ko?.trim() || matched?.i18n.ko || src.en?.trim() || vi,
    ja: src.ja?.trim() || matched?.i18n.ja || src.en?.trim() || vi,
    zh: src.zh?.trim() || matched?.i18n.zh || src.en?.trim() || vi,
    es: src.es?.trim() || matched?.i18n.es || src.en?.trim() || vi,
    it: src.it?.trim() || matched?.i18n.it || src.en?.trim() || vi,
    ru: src.ru?.trim() || matched?.i18n.ru || src.en?.trim() || vi,
  };
}

export function normalizeAndTranslateOptionGroups(
  groups: ItemOptionGroup[]
): ItemOptionGroup[] {
  return (groups || [])
    .filter((g) => g.name_i18n?.vi?.trim() && Array.isArray(g.choices))
    .map((group) => ({
      ...group,
      name_i18n: fillMissingOptionI18n(group.name_i18n),
      desc_i18n: group.desc_i18n?.vi?.trim()
        ? fillMissingOptionI18n(group.desc_i18n)
        : undefined,
      choices: group.choices
        .filter((c) => c.label_i18n?.vi?.trim())
        .map((c) => ({
          ...c,
          extra_price: Math.max(0, Number(c.extra_price) || 0),
          label_i18n: fillMissingOptionI18n(c.label_i18n),
          desc_i18n: c.desc_i18n?.vi?.trim()
            ? fillMissingOptionI18n(c.desc_i18n)
            : undefined,
        })),
    }))
    .filter((g) => g.choices.length > 0);
}
