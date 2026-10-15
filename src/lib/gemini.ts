import type { BusinessVertical, I18nText } from '@/types/qlaok';

export interface NineRouterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
}

export function getAiConfig(): NineRouterConfig | null {
  const baseUrl = (
    process.env.AI_BASE_URL || 'https://vunph.click/v1'
  ).replace(/\/+$/, '');
  const apiKey =
    process.env.AI_API_KEY || 'sk-07c9f002b12e445e-luaxyd-d0592739';
  const model = process.env.AI_MODEL || 'combo1';
  const visionModel = process.env.AI_VISION_MODEL || 'combo2';

  if (!apiKey || apiKey.trim() === '') {
    return null;
  }

  return { baseUrl, apiKey, model, visionModel };
}

export function isAiConfigured(): boolean {
  return Boolean(getAiConfig());
}

// Keep getGeminiClient alias for backwards compatibility in health checks
export function getGeminiClient() {
  return getAiConfig();
}

/**
 * Calls 9router OpenAI-compatible /chat/completions endpoint (handling both SSE chunks and JSON)
 * and parses the returned JSON payload.
 */
export async function call9RouterJson<T>(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>,
  modelOverride?: string
): Promise<T> {
  const config = getAiConfig();
  if (!config) {
    throw new Error('AI_NOT_CONFIGURED');
  }

  const targetModel = modelOverride || config.model;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: targetModel,
      messages,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`9router HTTP ${res.status}: ${errText}`);
  }

  const rawText = await res.text();
  let fullContent = '';

  if (rawText.trimStart().startsWith('data:')) {
    const lines = rawText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const chunk = JSON.parse(dataStr);
        const delta =
          chunk.choices?.[0]?.delta?.content ??
          chunk.choices?.[0]?.message?.content ??
          '';
        fullContent += delta;
      } catch {
        // ignore partial SSE line
      }
    }
  } else {
    const parsedResp = JSON.parse(rawText);
    fullContent =
      parsedResp.choices?.[0]?.message?.content ??
      parsedResp.choices?.[0]?.delta?.content ??
      '';
  }

  // Extract JSON object from fullContent (strip markdown ```json ... ``` if present)
  const fenceMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : fullContent.trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('9router response did not contain valid JSON object');
  }

  const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonSlice) as T;
}

// Smart dictionary & culinary/service localization fallback when running without GEMINI_API_KEY
const VIET_DICTIONARY: Array<{
  match: RegExp;
  en: string;
  ko: string;
  ja: string;
  zh: string;
  es: string;
  it: string;
  ru: string;
  desc?: I18nText;
}> = [
  {
    match: /bạc xỉu/i,
    en: 'Vietnamese Sweetened Condensed Milk Coffee (Bac Xiu)',
    ko: '연유가 듬뿍 들어간 베트남식 달콤한 라떼 (박씨우)',
    ja: 'ベトナム式練乳たっぷりアイスカフェオレ（バクシウ）',
    zh: '越式冰炼乳奶咖 (Bạc Xỉu - 奶香浓郁)',
    es: 'Café vietnamita helado con leche condensada dulce (Bac Xiu)',
    it: 'Caffè vietnamita ghiacciato con latte condensato dolce (Bac Xiu)',
    ru: 'Вьетнамский холодный кофе со сгущённым молоком (Бак Сиу)',
    desc: {
      vi: 'Sữa đặc béo ngậy hòa quyện cùng cà phê phin truyền thống đậm đà.',
      en: 'Creamy sweetened milk topped with aromatic Vietnamese phin drip coffee.',
      ko: '진한 베트남 핀 커피와 달콤하고 부드러운 연유 우유가 어우러진 시그니처 커피.',
      ja: '濃厚な練乳ミルクに香り高いベトナムコーヒーを合わせた甘くて飲みやすい一杯。',
      zh: '香甜顺滑的厚炼乳鲜奶搭配传统越式滴漏咖啡，柔和不苦涩。',
      es: 'Leche condensada cremosa combinada con aromático café vietnamita de filtro.',
      it: 'Latte condensato cremoso unito al profumato caffè vietnamita filtrato.',
      ru: 'Нежное сгущённое молоко в сочетании с ароматным вьетнамским кофе.',
    },
  },
  {
    match: /phở bò|phở tái|phở/i,
    en: 'Traditional Vietnamese Beef Noodle Soup (Pho Bo)',
    ko: '베트남 전통 진한 사골 소고기 쌀국수 (퍼 보)',
    ja: 'ベトナム伝統の特製牛肉フォー（フォー・ボー）',
    zh: '越南传统慢熬牛骨汤河粉 (Phở Bò)',
    es: 'Sopa tradicional vietnamita de fideos con ternera (Pho Bo)',
    it: 'Zuppa tradizionale vietnamita di noodles di riso e manzo (Pho Bo)',
    ru: 'Традиционный вьетнамский суп Фо Бо с говядиной и рисовой лапшой',
    desc: {
      vi: 'Nước dùng ninh xương bò 18 tiếng thanh ngọt tự nhiên, bánh phở mềm và thịt bò tươi.',
      en: '18-hour slow-simmered beef bone broth with soft rice noodles and tender beef.',
      ko: '18시간 우려낸 깊은 사골 육수와 부드러운 소고기, 쫄깃한 쌀국수 면발의 조화.',
      ja: '18時間煮込んだ香り高い牛骨スープと新鮮な牛肉、つるりとした米麺の絶妙な味わい。',
      zh: '18小时慢火熬制牛骨清汤，搭配鲜嫩牛肉与爽滑河粉。',
      es: 'Caldo de huesos de res cocido durante 18 horas con fideos de arroz y ternera tierna.',
      it: 'Brodo di manzo cotto lentamente per 18 ore con noodles di riso e carne tenera.',
      ru: 'Ароматный говяжий бульон 18-часовой варки с мягкой рисовой лапшой и свежей говядиной.',
    },
  },
  {
    match: /bánh mì/i,
    en: 'Crispy Vietnamese Baguette Sandwich (Banh Mi)',
    ko: '바삭한 베트남 전통 바게트 샌드위치 (반미)',
    ja: 'サクサク特製ベトナムバゲットサンド（バインミー）',
    zh: '越式香脆法棍三明治 (Bánh Mì)',
    es: 'Bocadillo vietnamita en baguette crujiente (Banh Mi)',
    it: 'Panino vietnamita in baguette croccante (Banh Mi)',
    ru: 'Хрустящий вьетнамский багет-сэндвич (Бань Ми)',
    desc: {
      vi: 'Bánh mì vỏ giòn rụm nhân thịt nướng, pate gan thơm béo, đồ chua và rau mùi.',
      en: 'Crusty Vietnamese baguette filled with savory grilled meats, house pate, pickled carrots, and herbs.',
      ko: '바삭한 바게트 속에 수제 파테, 숯불 구이 고기, 새콤달콤한 피클과 야채를 가득 채운 샌드위치.',
      ja: '焼きたてのサクサクバゲットに自家製パテ、グリル肉、なます、香草を挟んだ人気サンド。',
      zh: '外酥里嫩的越式法棍，内夹秘制肝酱、烤肉、酸甜萝卜丝与新鲜香草。',
      es: 'Baguette crujiente rellena de carne asada, paté casero, encurtidos y hierbas frescas.',
      it: 'Baguette croccante farcita con carne alla griglia, paté della casa, verdure marinate ed erbe.',
      ru: 'Хрустящий багет с мясом на гриле, домашним паштетом, маринованными овощами и зеленью.',
    },
  },
  {
    match: /cà phê muối/i,
    en: 'Salted Cream Vietnamese Iced Coffee (Ca Phe Muoi)',
    ko: '단짠 매력의 베트남 솔트 크림 커피 (소금커피)',
    ja: 'ベトナム名物 濃厚ソルトクリームコーヒー（塩コーヒー）',
    zh: '网红越式海盐奶盖冰咖啡',
    es: 'Café helado vietnamita con crema de sal marina (Ca Phe Muoi)',
    it: 'Caffè freddo vietnamita con crema al sale marino (Ca Phe Muoi)',
    ru: 'Вьетнамский кофе со сливочно-солёной пенкой (Кафе Муой)',
    desc: {
      vi: 'Lớp kem muối mặn dịu béo ngậy quyện cùng cà phê phin nguyên chất.',
      en: 'Velvety sea-salt cream layered over bold Vietnamese phin coffee.',
      ko: '부드럽고 짭짤한 수제 소금 크림과 진한 베트남 커피가 어우러진 인기 메뉴.',
      ja: 'ほんのり塩味の効いた濃厚クリームと香り高いベトナムコーヒーが絶妙にマッチ。',
      zh: '绵密微咸海盐奶盖融合醇厚滴漏咖啡，咸甜交织。',
      es: 'Suave crema con un toque de sal marina sobre café vietnamita intenso.',
      it: 'Vellutata crema al sale marino sopra un intenso caffè vietnamita.',
      ru: 'Нежная солёно-сливочная пенка поверх крепкого вьетнамского кофе.',
    },
  },
  {
    match: /gội đầu dưỡng sinh/i,
    en: 'Herbal Relaxing Head Spa & Scalp Massage',
    ko: '베트남식 힐링 한방 두피 케어 샴푸 & 마사지',
    ja: 'ベトナム式ハーブヘッドスパ＆頭皮リラクゼーション',
    zh: '越式草本养生洗头与头皮舒缓护理',
    es: 'Spa capilar herbal relajante y masaje de cuero cabelludo',
    it: 'Head Spa rilassante alle erbe e massaggio al cuoio capelluto',
    ru: 'Расслабляющий травяной спа-уход и массаж головы',
    desc: {
      vi: 'Gội thảo dược bồ kết sả chanh ấm, kết hợp bấm huyệt đầu, cổ vai gáy thư giãn sâu.',
      en: 'Warm natural lemongrass & locust herbal wash with relaxing scalp, neck, and shoulder acupressure.',
      ko: '따뜻한 천연 허브 워터 순환 케어와 두피·목·어깨 지압으로 피로를 풀어주는 힐링 코스.',
      ja: '温かい天然ハーブ湯と頭皮・首・肩のツボ押しマッサージで極上の癒しを体験。',
      zh: '采用温热香茅皂角草本水冲淋，配合头部与肩颈穴位按摩深度解压。',
      es: 'Lavado tibio con hierbas naturales de limoncillo y masaje relajante de cabeza, cuello y hombros.',
      it: 'Lavaggio caldo alle erbe naturali di citronella con digitopressione rilassante a testa, collo e spalle.',
      ru: 'Тёплое мытьё головы натуральным травяным отваром с точечным массажем головы, шеи и плеч.',
    },
  },
  {
    match: /massage|mát xa|cổ vai gáy/i,
    en: 'Therapeutic Neck, Shoulder & Body Aroma Massage',
    ko: '아로마 테라피 전신 & 목·어깨 집중 마사지',
    ja: 'アロマセラピー全身＆首・肩こり集中マッサージ',
    zh: '精油理疗全身及肩颈深度舒缓按摩',
    es: 'Masaje terapéutico aromático de cuello, hombros y cuerpo',
    it: 'Massaggio terapeutico aromatico per collo, spalle e corpo',
    ru: 'Терапевтический арома-массаж тела, шеи и воротниковой зоны',
    desc: {
      vi: 'Kỹ thuật ấn huyệt chuyên sâu kết hợp tinh dầu thiên nhiên giúp giảm đau mỏi tức thì.',
      en: 'Deep acupressure therapy with pure essential oils to melt away muscle tension.',
      ko: '천연 에센셜 오일과 숙련된 지압 테크닉으로 뭉친 근육과 여행 피로를 시원하게 풀어줍니다.',
      ja: '天然エッセンシャルオイルと熟練の指圧テクニックで、旅の疲れやコリを芯からほぐします。',
      zh: '结合纯天然精油与专业穴位推拿手法，迅速缓解肌肉酸痛与疲劳。',
      es: 'Terapia de acupresión profunda con aceites esenciales puros para aliviar la tensión muscular.',
      it: 'Digitopressione profonda con oli essenziali puri per sciogliere ogni tensione muscolare.',
      ru: 'Глубокий точечный массаж с натуральными эфирными маслами для снятия усталости.',
    },
  },
  {
    match: /nail|sơn gel|làm móng/i,
    en: 'Premium Korean Gel Nail Art & Cuticle Care',
    ko: '프리미엄 큐티클 케어 & 한국식 정품 컬러 젤네일',
    ja: '丁寧な甘皮ケア＆韓国風プレミアムジェルネイル',
    zh: '精致死皮护理 & 韩式进口凝胶美甲',
    es: 'Manicura de gel coreano premium y cuidado de cutículas',
    it: 'Nail Art in gel coreano premium e cura delle cuticole',
    ru: 'Премиальный корейский гель-лак и уход за кутикулой',
    desc: {
      vi: 'Nhặt da kỹ, tạo form móng chuẩn và sơn gel Hàn Quốc bền đẹp trên 4 tuần.',
      en: 'Includes precise cuticle care, nail shaping, and long-lasting Korean gel polish.',
      ko: '깔끔한 케어와 손톱 모양 정리, 4주 이상 유지되는 고발색 한국 정품 젤네일 시술.',
      ja: '丁寧な甘皮処理とファイリング、4週間以上長持ちする韓国製高品質ジェル仕上げ。',
      zh: '包含精细修型、去死皮护理及持久闪亮的韩国进口甲油胶。',
      es: 'Incluye limpieza de cutículas, limado y esmalte en gel coreano de larga duración.',
      it: 'Include cura precisa delle cuticole, limatura e smalto gel coreano a lunga tenuta.',
      ru: 'Включает аппаратную обработку кутикулы, выравнивание и стойкое корейское гель-покрытие.',
    },
  },
];

export function smartFallbackTranslate(params: {
  vertical: BusinessVertical;
  categoryNameVi?: string;
  itemNameVi: string;
  itemDescVi?: string;
}): {
  category_i18n: I18nText;
  name_i18n: I18nText;
  desc_i18n: I18nText;
} {
  const { vertical, categoryNameVi = 'Danh mục', itemNameVi, itemDescVi } = params;
  const cleanName = itemNameVi.trim() || 'Món đặc trưng';

  const matched = VIET_DICTIONARY.find((entry) => entry.match.test(cleanName));

  const name_i18n: I18nText = matched
    ? {
        vi: cleanName,
        en: matched.en,
        ko: matched.ko,
        ja: matched.ja,
        zh: matched.zh,
        es: matched.es,
        it: matched.it,
        ru: matched.ru,
      }
    : {
        vi: cleanName,
        en:
          vertical === 'service'
            ? `${cleanName} – Signature Spa & Care Package`
            : vertical === 'retail'
              ? `${cleanName} – Authentic Local Specialty`
              : `${cleanName} – Traditional Vietnamese Specialty`,
        ko:
          vertical === 'service'
            ? `${cleanName} (프리미엄 힐링 케어 코스)`
            : vertical === 'retail'
              ? `${cleanName} (베트남 로컬 특산품)`
              : `${cleanName} (베트남 정통 추천 메뉴)`,
        ja:
          vertical === 'service'
            ? `${cleanName}（特製リラクゼーションコース）`
            : vertical === 'retail'
              ? `${cleanName}（ベトナム名産お土産）`
              : `${cleanName}（ベトナム伝統のおすすめ料理）`,
        zh:
          vertical === 'service'
            ? `${cleanName}（特色养生护理套餐）`
            : vertical === 'retail'
              ? `${cleanName}（越南正宗特产伴手礼）`
              : `${cleanName}（越式招牌特色美食）`,
        es:
          vertical === 'service'
            ? `${cleanName} – Paquete de Spa y Bienestar`
            : vertical === 'retail'
              ? `${cleanName} – Especialidad Local Auténtica`
              : `${cleanName} – Especialidad Tradicional Vietnamita`,
        it:
          vertical === 'service'
            ? `${cleanName} – Trattamento Spa & Benessere`
            : vertical === 'retail'
              ? `${cleanName} – Specialità Locale Autentica`
              : `${cleanName} – Specialità Tradizionale Vietnamita`,
        ru:
          vertical === 'service'
            ? `${cleanName} – Фирменный спа-уход`
            : vertical === 'retail'
              ? `${cleanName} – Местный деликатес и сувенир`
              : `${cleanName} – Фирменное вьетнамское блюдо`,
      };

  const desc_i18n: I18nText =
    itemDescVi && itemDescVi.trim().length > 0
      ? {
          vi: itemDescVi.trim(),
          en: matched?.desc?.en || `${itemDescVi.trim()} — Freshly prepared with authentic local quality.`,
          ko: matched?.desc?.ko || `${itemDescVi.trim()} — 현지인들에게 사랑받는 인기 추천 메뉴입니다.`,
          ja: matched?.desc?.ja || `${itemDescVi.trim()} — 素材にこだわった当店自慢の一品です。`,
          zh: matched?.desc?.zh || `${itemDescVi.trim()} — 精选品质食材，深受游客喜爱。`,
          es: matched?.desc?.es || `${itemDescVi.trim()} — Preparado al momento con ingredientes locales frescos.`,
          it: matched?.desc?.it || `${itemDescVi.trim()} — Preparato fresco con ingredienti locali selezionati.`,
          ru: matched?.desc?.ru || `${itemDescVi.trim()} — Приготовлено из свежих местных ингредиентов.`,
        }
      : matched?.desc || {
          vi:
            vertical === 'service'
              ? 'Liệu trình thư giãn chuyên sâu bởi kỹ thuật viên giàu kinh nghiệm, giá niêm yết rõ ràng.'
              : vertical === 'retail'
                ? 'Sản phẩm chính gốc tuyển chọn, đóng gói kỹ lưỡng làm quà biếu sang trọng.'
                : 'Chế biến tươi mới mỗi ngày theo công thức đặc trưng của quán.',
          en:
            vertical === 'service'
              ? 'Relaxing professional treatment by experienced therapists with transparent pricing.'
              : vertical === 'retail'
                ? 'Authentic local product, carefully packaged and ready for travel gifting.'
                : 'Freshly prepared daily using our house signature recipe and local ingredients.',
          ko:
            vertical === 'service'
              ? '숙련된 전문 테라피스트의 세심한 케어와 투명한 정찰제로 운영됩니다.'
              : vertical === 'retail'
                ? '엄선된 베트남 로컬 정품으로 선물 및 여행 기념품으로 인기가 높습니다.'
                : '매일 신선한 재료와 매장만의 비법 레시피로 정성껏 조리합니다.',
          ja:
            vertical === 'service'
              ? '熟練スタッフによる丁寧な施術と明朗会計で安心してご利用いただけます。'
              : vertical === 'retail'
                ? '厳選された地元特産品。お土産やギフトに最適な丁寧なパッケージです。'
                : '毎日新鮮な食材を使い、当店秘伝のレシピで丁寧に仕上げています。',
          zh:
            vertical === 'service'
              ? '由资深技师提供专业舒适护理，明码标价无隐形消费。'
              : vertical === 'retail'
                ? '严选道地特产，包装精美，适合作为旅行伴手礼。'
                : '每日精选新鲜食材，按本店秘制配方现点现做。',
          es:
            vertical === 'service'
              ? 'Tratamiento relajante por terapeutas expertos con precios transparentes.'
              : vertical === 'retail'
                ? 'Producto local auténtico, empacado cuidadosamente para regalo o viaje.'
                : 'Preparado fresco cada día con nuestra receta tradicional de la casa.',
          it:
            vertical === 'service'
              ? 'Trattamento professionale rilassante con prezzi chiari e trasparenti.'
              : vertical === 'retail'
                ? 'Prodotto locale autentico, confezionato con cura come regalo di viaggio.'
                : 'Preparato fresco ogni giorno secondo la ricetta tradizionale della casa.',
          ru:
            vertical === 'service'
              ? 'Профессиональный расслабляющий уход от опытных мастеров по фиксированной цене.'
              : vertical === 'retail'
                ? 'Оригинальный местный продукт в надёжной подарочной упаковке.'
                : 'Ежедневно готовится из свежих продуктов по фирменному рецепту заведения.',
        };

  const category_i18n: I18nText = {
    vi: categoryNameVi,
    en: categoryNameVi === 'Danh mục' ? 'Featured Selection' : `${categoryNameVi} (Menu)`,
    ko: '추천 카테고리',
    ja: 'おすすめカテゴリー',
    zh: '精选分类',
    es: 'Selección destacada',
    it: 'Selezione consigliata',
    ru: 'Рекомендуемые позиции',
  };

  return { category_i18n, name_i18n, desc_i18n };
}

export function getDemoOcrResult(vertical: BusinessVertical) {
  if (vertical === 'service') {
    return {
      categories: [
        {
          name_i18n: {
            vi: 'Combo Dưỡng Sinh & Thư Giãn (Quét từ ảnh)',
            en: 'Head Spa & Relaxation Combos',
            ko: '두피 케어 & 힐링 마사지 콤보',
            ja: 'ヘッドスパ＆リラクゼーションセット',
            zh: '养生洗头与舒缓按摩套餐',
            es: 'Paquetes de Spa Capilar y Relajación',
            it: 'Pacchetti Head Spa e Relax',
            ru: 'Комплексы спа-ухода за головой и массажа',
          },
          items: [
            {
              price: 199000,
              duration_mins: 70,
              name_i18n: {
                vi: 'Combo Gội Đầu Thảo Dược + Ngâm Chân Đá Muối Himalaya',
                en: 'Herbal Head Spa + Himalayan Salt Foot Soak Combo',
                ko: '허브 두피 샴푸 + 히말라야 핑크솔트 족욕 콤보',
                ja: 'ハーブヘッドスパ＋ヒマラヤ岩塩フットバスセット',
                zh: '草本养生洗头 + 喜马拉雅玫瑰盐泡脚套餐',
                es: 'Combo Spa Capilar Herbal + Baño de Pies con Sal del Himalaya',
                it: 'Combo Head Spa alle Erbe + Pediluvio al Sale Himalayano',
                ru: 'Травяной спа-уход за головой + ванночка для ног с гималайской солью',
              },
              desc_i18n: {
                vi: 'Thư giãn toàn diện 70 phút: gội thảo mộc, massage cổ vai gáy và ngâm chân thải độc.',
                en: '70-min full relaxation: herbal hair wash, neck/shoulder massage, and detox foot soak.',
                ko: '70분간의 완벽한 힐링: 천연 허브 샴푸, 목·어깨 지압, 피로 회복 족욕 포함.',
                ja: '70分の贅沢ケア：ハーブシャンプー、首肩マッサージ、デトックス足湯付き。',
                zh: '70分钟全方位放松：含草本洗发、肩颈按摩与排毒足浴。',
                es: '70 min de relajación total: lavado herbal, masaje de cuello y baño de pies detox.',
                it: '70 min di puro relax: lavaggio alle erbe, massaggio collo/spalle e pediluvio detox.',
                ru: '70 минут полного релакса: травяное мытьё головы, массаж шеи и детокс-ванночка для ног.',
              },
            },
            {
              price: 250000,
              duration_mins: 60,
              name_i18n: {
                vi: 'Massage Cổ Vai Gáy Chuyên Sâu Đá Nóng',
                en: 'Deep Tissue Neck & Shoulder Hot Stone Therapy',
                ko: '목·어깨 집중 핫스톤 테라피 마사지',
                ja: '首・肩・背中集中ホットストーンマッサージ',
                zh: '肩颈背部热石深度理疗按摩',
                es: 'Masaje Profundo de Cuello y Hombros con Piedras Calientes',
                it: 'Massaggio Profondo Collo e Spalle con Pietre Calde',
                ru: 'Глубокий массаж шеи и плеч горячими камнями',
              },
              desc_i18n: {
                vi: 'Đánh tan đau mỏi vai gáy cho dân văn phòng và khách du lịch đi bộ nhiều.',
                en: 'Relieves deep neck and shoulder stiffness with warm volcanic stones.',
                ko: '따뜻한 스톤으로 뭉친 어깨와 승모근을 시원하게 풀어주는 집중 케어.',
                ja: '温かいストーンで首や肩の頑固なコリを芯からほぐします。',
                zh: '运用温热火山石深度疏通肩颈经络，缓解僵硬酸痛。',
                es: 'Alivia la rigidez de cuello y hombros con piedras volcánicas calientes.',
                it: 'Scioglie le tensioni di collo e spalle con pietre vulcaniche calde.',
                ru: 'Снимает напряжение в шее и спине с помощью тёплых вулканических камней.',
              },
            },
          ],
        },
      ],
    };
  }

  if (vertical === 'retail') {
    return {
      categories: [
        {
          name_i18n: {
            vi: 'Đặc Sản Quà Biếu (Quét từ bảng giá)',
            en: 'Local Specialty Gift Packs',
            ko: '베트남 로컬 특산품 선물세트',
            ja: 'ベトナム名産お土産セット',
            zh: '越南特色伴手礼精选',
            es: 'Paquetes de Regalo y Especialidades Locales',
            it: 'Confezioni Regalo di Specialità Locali',
            ru: 'Подарочные наборы местных деликатесов',
          },
          items: [
            {
              price: 95000,
              duration_mins: null,
              name_i18n: {
                vi: 'Xoài Sấy Dẻo Muối Ớt Đặc Sản (Hộp 300g)',
                en: 'Chewy Dried Mango with Chili Salt (300g Gift Box)',
                ko: '매콤달콤 칠리솔트 건망고 (300g 선물박스)',
                ja: 'チリソルト入り柔らかドライマンゴー（300g箱）',
                zh: '椒盐香甜软糯芒果干（300克礼盒装）',
                es: 'Mango Deshidratado Suave con Sal de Chile (Caja 300g)',
                it: 'Mango Essiccato Morbido al Sale e Peperoncino (Scatola 300g)',
                ru: 'Мягкое сушёное манго с солью и чили (коробка 300 г)',
              },
              desc_i18n: {
                vi: 'Xoài chín cây sấy lạnh giữ nguyên vị ngọt tự nhiên, chấm muối ớt cực cuốn.',
                en: 'Sun-ripened Vietnamese mango, cold-dried for natural sweetness with a hint of chili salt.',
                ko: '자연 숙성 망고를 저온 건조하여 쫀득하고 달콤한 인기 간식.',
                ja: '完熟マンゴーを低温乾燥でしっとり仕上げた一番人気のお土産。',
                zh: '自然熟成的越南芒果低温慢烘，果肉厚实软糯。',
                es: 'Mango vietnamita madurado al sol y secado en frío con un toque de sal de chile.',
                it: 'Mango vietnamita maturato al sole ed essiccato a freddo per una dolcezza naturale.',
                ru: 'Спелое вьетнамское манго бережной сушки с пикантной чили-солью.',
              },
            },
            {
              price: 110000,
              duration_mins: null,
              name_i18n: {
                vi: 'Trà Sâm Dứa Hoa Nhài Hội An Thượng Hạng (Gói 500g)',
                en: 'Premium Hoi An Pandan & Jasmine Herbal Tea (500g)',
                ko: '호이안 프리미엄 판단잎 & 자스민 허브차 (500g)',
                ja: 'ホイアン特選パンダン＆ジャスミン茶（500g）',
                zh: '会安特级香兰茉莉草本茶（500克大包装）',
                es: 'Té Herbal Premium de Pandan y Jazmín de Hoi An (500g)',
                it: 'Tè Pregiato alle Erbe Pandan e Gelsomino di Hoi An (500g)',
                ru: 'Премиальный травяной чай с панданом и жасмином из Хойана (500 г)',
              },
              desc_i18n: {
                vi: 'Hương lá dứa thơm ngát thanh nhiệt, uống nóng hay pha trà đá đều tuyệt ngon.',
                en: 'Fragrant pandan leaf and green tea blend, delicious both hot and iced.',
                ko: '은은하고 고소한 판단잎 향이 일품인 베트남 중부 명물 전통차.',
                ja: '爽やかなパンダンリーフが香る、アイスでもホットでも美味しいベトナム茶。',
                zh: '清香扑鼻的香兰叶与茉莉绿茶拼配，冷泡热饮皆宜。',
                es: 'Mezcla aromática de hojas de pandan y té verde, deliciosa fría o caliente.',
                it: 'Miscela profumata di foglie di pandan e tè verde, ottima calda o fredda.',
                ru: 'Ароматный зелёный чай с листьями пандана и жасмином, вкусен горячим и холодным.',
              },
            },
          ],
        },
      ],
    };
  }

  return {
    categories: [
      {
        name_i18n: {
          vi: 'Thực Đơn Quét AI (Món Mới)',
          en: 'AI Scanned Menu Specials',
          ko: 'AI 스캔 추천 메뉴',
          ja: 'AIスキャンおすすめメニュー',
          zh: 'AI 扫描精选菜单',
          es: 'Especialidades del Menú Escaneado',
          it: 'Specialità del Menu Scansionato',
          ru: 'Специальные блюда из меню',
        },
        items: [
          {
            price: 45000,
            duration_mins: null,
            name_i18n: {
              vi: 'Bánh Mì Thịt Nướng Sả Ớt Hội An',
              en: 'Hoi An Lemongrass Grilled Pork Banh Mi Sandwich',
              ko: '호이안식 레몬그라스 숯불 돼지고기 반미 바게트',
              ja: 'ホイアン風レモングラス豚焼肉バインミー',
              zh: '会安香茅炭烤猪肉越式法棍 (Bánh Mì)',
              es: 'Banh Mi de Cerdo Asado con Limoncillo Estilo Hoi An',
              it: 'Banh Mi di Maiale alla Griglia alla Citronella Stile Hoi An',
              ru: 'Хрустящий багет Бань Ми со свининой на гриле по-хойански',
            },
            desc_i18n: {
              vi: 'Bánh mì giòn nóng kẹp thịt nướng than hoa, pate nhà làm và nước sốt đậm đà.',
              en: 'Crispy hot baguette loaded with charcoal-grilled lemongrass pork, house pate, and herbs.',
              ko: '갓 구운 바삭한 바게트에 숯불향 가득한 돼지고기와 특제 소스를 넣은 반미.',
              ja: '炭火で香ばしく焼いた豚肉と自家製パテを挟んだ絶品バインミー。',
              zh: '酥脆热法棍夹满炭火香茅烤肉、自制肝酱与秘制酱汁。',
              es: 'Baguette caliente y crujiente con cerdo asado al carbón, paté casero y hierbas.',
              it: 'Baguette calda e croccante con maiale alla brace, paté fatto in casa ed erbe.',
              ru: 'Горячий хрустящий багет со свининой на углях, домашним паштетом и соусом.',
            },
          },
          {
            price: 60000,
            duration_mins: null,
            name_i18n: {
              vi: 'Bún Chả Hà Nội Truyền Thống',
              en: 'Hanoi Charcoal-Grilled Pork & Vermicelli (Bun Cha)',
              ko: '하노이 전통 숯불 돼지고기 쌀국수 (분짜)',
              ja: 'ハノイ名物 炭火焼きつくねのつけ麺（ブンチャー）',
              zh: '河内传统炭烤猪肉米线 (Bún Chả)',
              es: 'Cerdo Asado al Carbón con Fideos de Arroz de Hanói (Bun Cha)',
              it: 'Maiale alla Brace di Hanoi con Vermicelli di Riso (Bun Cha)',
              ru: 'Ханойский Бун Ча: свинина на углях с рисовой лапшой',
            },
            desc_i18n: {
              vi: 'Chả viên và thịt ba chỉ nướng than hoa ăn cùng bún tươi, nước mắm đu đủ xanh chua ngọt.',
              en: 'Smoky grilled pork patties and belly served with rice noodles, herbs, and sweet-sour dipping broth.',
              ko: '숯불에 구운 돼지고기 패티와 삼겹살을 새콤달콤한 느억맘 육수에 적셔 먹는 인기 메뉴.',
              ja: '香ばしい炭火焼き豚肉と米麺を甘酸っぱい特製ダレにつけて食べる人気料理。',
              zh: '炭火现烤猪肉饼与五花肉，配爽滑米线、香草及木瓜酸甜鱼露汤。',
              es: 'Albóndigas y panceta de cerdo a la brasa servidas con fideos de arroz y salsa agridulce.',
              it: 'Polpette e pancetta di maiale alla brace servite con noodles di riso e salsa agrodolce.',
              ru: 'Котлетки и грудинка на углях с рисовой вермишелью, зеленью и кисло-сладким соусом.',
            },
          },
          {
            price: 35000,
            duration_mins: null,
            name_i18n: {
              vi: 'Trà Đào Cam Sả Mát Lạnh',
              en: 'Iced Peach, Orange & Lemongrass Refresher Tea',
              ko: '시원한 복숭아 오렌지 레몬그라스 아이스티 (짜다오깜사)',
              ja: '桃とオレンジ・レモングラスの爽やかフルーツティー',
              zh: '鲜爽蜜桃香橙香茅冰茶 (Trà Đào Cam Sả)',
              es: 'Té Helado Refrescante de Melocotón, Naranja y Limoncillo',
              it: 'Tè Freddo Rinfrescante alla Pesca, Arancia e Citronella',
              ru: 'Освежающий холодный чай с персиком, апельсином и лемонграссом',
            },
            desc_i18n: {
              vi: 'Trà đen ủ lạnh kết hợp đào miếng giòn ngọt, cam vàng tươi và hương sả thơm dịu.',
              en: 'Chilled black tea infused with crunchy peach slices, fresh orange, and aromatic lemongrass.',
              ko: '아삭한 복숭아 과육과 상큼한 오렌지, 향긋한 레몬그라스가 어우러진 베트남 국민 음료.',
              ja: '果肉入りピーチとフレッシュオレンジ、レモングラスが香る大人気トロピカルティー。',
              zh: '冷萃红茶搭配脆甜黄桃果肉、鲜橙切片与清新香茅。',
              es: 'Té negro frío con trozos de melocotón crujiente, naranja fresca y aroma de limoncillo.',
              it: 'Tè nero freddo con fette di pesca croccante, arancia fresca e profumo di citronella.',
              ru: 'Холодный чёрный чай с кусочками персика, свежим апельсином и ароматом лемонграсса.',
            },
          },
        ],
      },
    ],
  };
}

const OCR_DIACRITIC_RESTORE: Array<[RegExp, string]> = [
  [/^ca\s*phe\s*den$/i, 'Cà Phê Đen'],
  [/^ca\s*phe\s*sua$/i, 'Cà Phê Sữa'],
  [/^bac\s*xiu$/i, 'Bạc Xỉu'],
  [/^ca\s*phe\s*kem$/i, 'Cà Phê Kem'],
  [/^ca\s*phe\s*trung$/i, 'Cà Phê Trứng'],
  [/^sua\s*chua\s*ca\s*phe$/i, 'Sữa Chua Cà Phê'],
  [/^cot\s*dua\s*ca\s*phe$/i, 'Cốt Dừa Cà Phê'],
  [/^cot\s*dua\s*com\s*xanh$/i, 'Cốt Dừa Cốm Xanh'],
  [/^(?:tra\s*)?vai$/i, 'Trà Vải'],
  [/^(?:tra\s*)?gung$/i, 'Trà Gừng'],
  [/^(?:tra\s*)?dao\s*cam\s*sa$/i, 'Trà Đào Cam Sả'],
  [/^(?:tra\s*)?vai\s*hoa\s*hong$/i, 'Trà Vải Hoa Hồng'],
  [/^(?:tra\s*)?chanh\s*sa\s*hat\s*dac$/i, 'Trà Chanh Sả Hạt Đác'],
  [/^dau\s*tam\s*pha\s*le\s*tuyet$/i, 'Dâu Tằm Pha Lê Tuyết'],
  [/^bo\s*ngon$/i, 'Sinh Tố Bơ Ngon'],
  [/^xoai\s*xanh$/i, 'Xoài Xanh Đá Xay'],
  [/^mang\s*cau$/i, 'Sinh Tố Mãng Cầu'],
  [/^chanh\s*tuyet$/i, 'Chanh Tuyết'],
  [/^viet\s*quat\s*da\s*xay$/i, 'Việt Quất Đá Xay'],
];

function normalizeOcrItemName(raw: string): string {
  const cleaned = raw
    .replace(/^[\d.)\s\-–•·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const asciiKey = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd');
  for (const [pattern, replacement] of OCR_DIACRITIC_RESTORE) {
    if (pattern.test(asciiKey)) {
      return replacement;
    }
  }
  return cleaned;
}

/**
 * Parses actual OCR text lines (including multi-column lines where 2-3 items+prices appear on the same line)
 * when the external AI service is offline or times out.
 */
export function parseRawOcrTextFallback(
  rawText: string,
  vertical: BusinessVertical
) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/[|_~•·]+/g, ' ').trim())
    .filter((l) => l.length >= 2);

  const items: Array<{
    price: number;
    duration_mins: number | null;
    name_i18n: I18nText;
    desc_i18n: I18nText;
  }> = [];
  const seenKeys = new Set<string>();

  for (const line of lines) {
    // Extract one or more "<item name> <price>" pairs per line (supports multi-column menus)
    const pairRegex =
      /([^\d\n]+?)\s*[-–.:]*\s*(\d{1,4}(?:[.,]\d{3})+|\d{1,4}\s*[kK]|\b\d{2,3}\b)\s*(?:đ|vnd|vnđ|d)?(?=\s|$)/gi;
    const matches = Array.from(line.matchAll(pairRegex));

    for (const m of matches) {
      const rawName = normalizeOcrItemName(m[1] || '');
      const rawPriceStr = (m[2] || '').trim().toLowerCase();

      if (rawName.length < 2 || /^\d+$/.test(rawName)) continue;

      let price = 0;
      if (rawPriceStr.endsWith('k')) {
        price = parseInt(rawPriceStr.replace(/[^\d]/g, ''), 10) * 1000;
      } else if (/[.,]\d{3}/.test(rawPriceStr)) {
        price = parseInt(rawPriceStr.replace(/[^\d]/g, ''), 10);
      } else {
        const n = parseInt(rawPriceStr, 10);
        price = n > 0 && n < 1000 ? n * 1000 : n;
      }

      if (!price || price < 1000) continue;

      const dedupeKey = `${rawName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()}-${price}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const translated = smartFallbackTranslate({
        vertical,
        itemNameVi: rawName,
      });

      items.push({
        price,
        duration_mins: vertical === 'service' ? 60 : null,
        name_i18n: translated.name_i18n,
        desc_i18n: translated.desc_i18n,
      });
    }
  }

  return {
    categories: [
      {
        name_i18n: {
          vi: 'Thực Đơn Quét Tự Động',
          en: 'Scanned Menu Items',
          ko: '스캔된 메뉴',
          ja: 'スキャンされたメニュー',
          zh: '自动扫描菜单',
          es: 'Menú Escaneado Automáticamente',
          it: 'Menu Scansionato Automaticamente',
          ru: 'Автоматически отсканированное меню',
        },
        items,
      },
    ],
  };
}

