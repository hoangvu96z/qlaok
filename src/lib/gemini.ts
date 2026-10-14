import { BusinessVertical, I18nText } from '@/types/qlaok';

export interface NineRouterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function getAiConfig(): NineRouterConfig | null {
  const baseUrl = (
    process.env.AI_BASE_URL || 'https://vunph.click/v1'
  ).replace(/\/+$/, '');
  const apiKey =
    process.env.AI_API_KEY || 'sk-07c9f002b12e445e-luaxyd-d0592739';
  const model = process.env.AI_MODEL || 'combo1';

  if (!apiKey || apiKey.trim() === '') {
    return null;
  }

  return { baseUrl, apiKey, model };
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
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>
): Promise<T> {
  const config = getAiConfig();
  if (!config) {
    throw new Error('AI_NOT_CONFIGURED');
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(20000),
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
  desc?: I18nText;
}> = [
  {
    match: /bạc xỉu/i,
    en: 'Vietnamese Sweetened Condensed Milk Coffee (Bac Xiu)',
    ko: '연유가 듬뿍 들어간 베트남식 달콤한 라떼 (박씨우)',
    ja: 'ベトナム式練乳たっぷりアイスカフェオレ（バクシウ）',
    zh: '越式冰炼乳奶咖 (Bạc Xỉu - 奶香浓郁)',
    desc: {
      vi: 'Sữa đặc béo ngậy hòa quyện cùng cà phê phin truyền thống đậm đà.',
      en: 'Creamy sweetened milk topped with aromatic Vietnamese phin drip coffee.',
      ko: '진한 베트남 핀 커피와 달콤하고 부드러운 연유 우유가 어우러진 시그니처 커피.',
      ja: '濃厚な練乳ミルクに香り高いベトナムコーヒーを合わせた甘くて飲みやすい一杯。',
      zh: '香甜顺滑的厚炼乳鲜奶搭配传统越式滴漏咖啡，柔和不苦涩。',
    },
  },
  {
    match: /phở bò|phở tái|phở/i,
    en: 'Traditional Vietnamese Beef Noodle Soup (Pho Bo)',
    ko: '베트남 전통 진한 사골 소고기 쌀국수 (퍼 보)',
    ja: 'ベトナム伝統の特製牛肉フォー（フォー・ボー）',
    zh: '越南传统慢熬牛骨汤河粉 (Phở Bò)',
    desc: {
      vi: 'Nước dùng ninh xương bò 18 tiếng thanh ngọt tự nhiên, bánh phở mềm và thịt bò tươi.',
      en: '18-hour slow-simmered beef bone broth with soft rice noodles and tender beef.',
      ko: '18시간 우려낸 깊은 사골 육수와 부드러운 소고기, 쫄깃한 쌀국수 면발의 조화.',
      ja: '18時間煮込んだ香り高い牛骨スープと新鮮な牛肉、つるりとした米麺の絶妙な味わい。',
      zh: '18小时慢火熬制牛骨清汤，搭配鲜嫩牛肉与爽滑河粉。',
    },
  },
  {
    match: /bánh mì/i,
    en: 'Crispy Vietnamese Baguette Sandwich (Banh Mi)',
    ko: '바삭한 베트남 전통 바게트 샌드위치 (반미)',
    ja: 'サクサク特製ベトナムバゲットサンド（バインミー）',
    zh: '越式香脆法棍三明治 (Bánh Mì)',
    desc: {
      vi: 'Bánh mì vỏ giòn rụm nhân thịt nướng, pate gan thơm béo, đồ chua và rau mùi.',
      en: 'Crusty Vietnamese baguette filled with savory grilled meats, house pate, pickled carrots, and herbs.',
      ko: '바삭한 바게트 속에 수제 파테, 숯불 구이 고기, 새콤달콤한 피클과 야채를 가득 채운 샌드위치.',
      ja: '焼きたてのサクサクバゲットに自家製パテ、グリル肉、なます、香초を挟んだ人気サンド。',
      zh: '外酥里嫩的越式法棍，内夹秘制肝酱、烤肉、酸甜萝卜丝与新鲜香草。',
    },
  },
  {
    match: /cà phê muối/i,
    en: 'Salted Cream Vietnamese Iced Coffee (Ca Phe Muoi)',
    ko: '단짠 매력의 베트남 솔트 크림 커피 (소금커피)',
    ja: 'ベトナム名物 濃厚ソルトクリームコーヒー（塩コーヒー）',
    zh: '网红越式海盐奶盖冰咖啡',
    desc: {
      vi: 'Lớp kem muối mặn dịu béo ngậy quyện cùng cà phê phin nguyên chất.',
      en: 'Velvety sea-salt cream layered over bold Vietnamese phin coffee.',
      ko: '부드럽고 짭짤한 수제 소금 크림과 진한 베트남 커피가 어우러진 인기 메뉴.',
      ja: 'ほんのり塩味の効いた濃厚クリームと香り高いベトナムコーヒーが絶妙にマッチ。',
      zh: '绵密微咸海盐奶盖融合醇厚滴漏咖啡，咸甜交织。',
    },
  },
  {
    match: /gội đầu dưỡng sinh/i,
    en: 'Herbal Relaxing Head Spa & Scalp Massage',
    ko: '베트남식 힐링 한방 두피 케어 샴푸 & 마사지',
    ja: 'ベトナム式ハーブヘッドスパ＆頭皮リラクゼーション',
    zh: '越式草本养生洗头与头皮舒缓护理',
    desc: {
      vi: 'Gội thảo dược bồ kết sả chanh ấm, kết hợp bấm huyệt đầu, cổ vai gáy thư giãn sâu.',
      en: 'Warm natural lemongrass & locust herbal wash with relaxing scalp, neck, and shoulder acupressure.',
      ko: '따뜻한 천연 허브 워터 순환 케어와 두피·목·어깨 지압으로 피로를 풀어주는 힐링 코스.',
      ja: '温かい天然ハーブ湯と頭皮・首・肩のツボ押しマッサージで極上の癒しを体験。',
      zh: '采用温热香茅皂角草本水冲淋，配合头部与肩颈穴位按摩深度解压。',
    },
  },
  {
    match: /massage|mát xa|cổ vai gáy/i,
    en: 'Therapeutic Neck, Shoulder & Body Aroma Massage',
    ko: '아로마 테라피 전신 & 목·어깨 집중 마사지',
    ja: 'アロマセラピー全身＆首・肩こり集中マッサージ',
    zh: '精油理疗全身及肩颈深度舒缓按摩',
    desc: {
      vi: 'Kỹ thuật ấn huyệt chuyên sâu kết hợp tinh dầu thiên nhiên giúp giảm đau mỏi tức thì.',
      en: 'Deep acupressure therapy with pure essential oils to melt away muscle tension.',
      ko: '천연 에센셜 오일과 숙련된 지압 테크닉으로 뭉친 근육과 여행 피로를 시원하게 풀어줍니다.',
      ja: '天然エッセンシャルオイルと熟練の指圧テクニックで、旅の疲れやコリを芯からほぐします。',
      zh: '结合纯天然精油与专业穴位推拿手法，迅速缓解肌肉酸痛与疲劳。',
    },
  },
  {
    match: /nail|sơn gel|làm móng/i,
    en: 'Premium Korean Gel Nail Art & Cuticle Care',
    ko: '프리미엄 큐티클 케어 & 한국식 정품 컬러 젤네일',
    ja: '丁寧な甘皮ケア＆韓国風プレミアムジェルネイル',
    zh: '精致死皮护理 & 韩式进口凝胶美甲',
    desc: {
      vi: 'Nhặt da kỹ, tạo form móng chuẩn và sơn gel Hàn Quốc bền đẹp trên 4 tuần.',
      en: 'Includes precise cuticle care, nail shaping, and long-lasting Korean gel polish.',
      ko: '깔끔한 케어와 손톱 모양 정리, 4주 이상 유지되는 고발색 한국 정품 젤네일 시술.',
      ja: '丁寧な甘皮処理とファイリング、4週間以上長持ちする韓国製高品質ジェル仕上げ。',
      zh: '包含精细修型、去死皮护理及持久闪亮的韩国进口甲油胶。',
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
      };

  const desc_i18n: I18nText =
    itemDescVi && itemDescVi.trim().length > 0
      ? {
          vi: itemDescVi.trim(),
          en: matched?.desc?.en || `${itemDescVi.trim()} — Freshly prepared with authentic local quality.`,
          ko: matched?.desc?.ko || `${itemDescVi.trim()} — 현지인들에게 사랑받는 인기 추천 메뉴입니다.`,
          ja: matched?.desc?.ja || `${itemDescVi.trim()} — 素材にこだわった当店自慢の一品です。`,
          zh: matched?.desc?.zh || `${itemDescVi.trim()} — 精选品质食材，深受游客喜爱。`,
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
        };

  const category_i18n: I18nText = {
    vi: categoryNameVi,
    en: categoryNameVi === 'Danh mục' ? 'Featured Selection' : `${categoryNameVi} (Menu)`,
    ko: '추천 카테고리',
    ja: 'おすすめカテゴリー',
    zh: '精选分类',
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
              },
              desc_i18n: {
                vi: 'Thư giãn toàn diện 70 phút: gội thảo mộc, massage cổ vai gáy và ngâm chân thải độc.',
                en: '70-min full relaxation: herbal hair wash, neck/shoulder massage, and detox foot soak.',
                ko: '70분간의 완벽한 힐링: 천연 허브 샴푸, 목·어깨 지압, 피로 회복 족욕 포함.',
                ja: '70分の贅沢ケア：ハーブシャンプー、首肩マッサージ、デトックス足湯付き。',
                zh: '70分钟全方位放松：含草本洗发、肩颈按摩与排毒足浴。',
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
              },
              desc_i18n: {
                vi: 'Đánh tan đau mỏi vai gáy cho dân văn phòng và khách du lịch đi bộ nhiều.',
                en: 'Relieves deep neck and shoulder stiffness with warm volcanic stones.',
                ko: '따뜻한 스톤으로 뭉친 어깨와 승모근을 시원하게 풀어주는 집중 케어.',
                ja: '温かいストーンで首や肩の頑固なコリを芯からほぐします。',
                zh: '运用温热火山石深度疏通肩颈经络，缓解僵硬酸痛。',
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
              },
              desc_i18n: {
                vi: 'Xoài chín cây sấy lạnh giữ nguyên vị ngọt tự nhiên, chấm muối ớt cực cuốn.',
                en: 'Sun-ripened Vietnamese mango, cold-dried for natural sweetness with a hint of chili salt.',
                ko: '자연 숙성 망고를 저온 건조하여 쫀득하고 달콤한 인기 간식.',
                ja: '完熟マンゴーを低温乾燥でしっとり仕上げた一番人気のお土産。',
                zh: '自然熟成的越南芒果低温慢烘，果肉厚实软糯。',
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
              },
              desc_i18n: {
                vi: 'Hương lá dứa thơm ngát thanh nhiệt, uống nóng hay pha trà đá đều tuyệt ngon.',
                en: 'Fragrant pandan leaf and green tea blend, delicious both hot and iced.',
                ko: '은은하고 고소한 판단잎 향이 일품인 베트남 중부 명물 전통차.',
                ja: '爽やかなパンダンリーフが香る、アイスでもホットでも美味しいベトナム茶。',
                zh: '清香扑鼻的香兰叶与茉莉绿茶拼配，冷泡热饮皆宜。',
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
            },
            desc_i18n: {
              vi: 'Bánh mì giòn nóng kẹp thịt nướng than hoa, pate nhà làm và nước sốt đậm đà.',
              en: 'Crispy hot baguette loaded with charcoal-grilled lemongrass pork, house pate, and herbs.',
              ko: '갓 구운 바삭한 바게트에 숯불향 가득한 돼지고기와 특제 소스를 넣은 반미.',
              ja: '炭火で香ばしく焼いた豚肉と自家製パテを挟んだ絶品バインミー。',
              zh: '酥脆热法棍夹满炭火香茅烤肉、自制肝酱与秘制酱汁。',
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
            },
            desc_i18n: {
              vi: 'Chả viên và thịt ba chỉ nướng than hoa ăn cùng bún tươi, nước mắm đu đủ xanh chua ngọt.',
              en: 'Smoky grilled pork patties and belly served with rice noodles, herbs, and sweet-sour dipping broth.',
              ko: '숯불에 구운 돼지고기 패티와 삼겹살을 새콤달콤한 느억맘 육수에 적셔 먹는 인기 메뉴.',
              ja: '香ばしい炭火焼き豚肉と米麺を甘酸っぱい特製ダレにつけて食べる人気料理。',
              zh: '炭火现烤猪肉饼与五花肉，配爽滑米线、香草及木瓜酸甜鱼露汤。',
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
            },
            desc_i18n: {
              vi: 'Trà đen ủ lạnh kết hợp đào miếng giòn ngọt, cam vàng tươi và hương sả thơm dịu.',
              en: 'Chilled black tea infused with crunchy peach slices, fresh orange, and aromatic lemongrass.',
              ko: '아삭한 복숭아 과육과 상큼한 오렌지, 향긋한 레몬그라스가 어우러진 베트남 국민 음료.',
              ja: '果肉入りピーチとフレッシュオレンジ、レモングラスが香る大人気トロピカルティー。',
              zh: '冷萃红茶搭配脆甜黄桃果肉、鲜橙切片与清新香茅。',
            },
          },
        ],
      },
    ],
  };
}
