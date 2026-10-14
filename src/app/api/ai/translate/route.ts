import { NextResponse } from 'next/server';
import {
  call9RouterJson,
  getAiConfig,
  smartFallbackTranslate,
} from '@/lib/gemini';
import { BusinessVertical, I18nText } from '@/types/qlaok';

interface TranslationAiResponse {
  category_i18n?: I18nText;
  name_i18n: I18nText;
  desc_i18n: I18nText;
}

export async function POST(req: Request) {
  let vertical: BusinessVertical = 'fnb';
  let categoryNameVi = 'Danh mục';
  let itemNameVi = '';
  let itemDescVi = '';

  try {
    const body = await req.json();
    vertical = body.vertical || 'fnb';
    categoryNameVi = body.categoryNameVi || 'Danh mục';
    itemNameVi = body.itemNameVi || '';
    itemDescVi = body.itemDescVi || '';

    if (!itemNameVi || !itemNameVi.trim()) {
      return NextResponse.json(
        { error: 'Vui lòng nhập tên món / dịch vụ bằng Tiếng Việt' },
        { status: 400 }
      );
    }

    const aiConfig = getAiConfig();
    if (!aiConfig) {
      const fallbackResult = smartFallbackTranslate({
        vertical,
        categoryNameVi,
        itemNameVi,
        itemDescVi,
      });
      return NextResponse.json({
        ...fallbackResult,
        provider: 'local-smart-dictionary',
      });
    }

    const systemPrompt = `Bạn là chuyên gia bản địa hóa Menu Ẩm thực (F&B), Bảng giá Dịch vụ (Nail, Spa, Massage) và Danh mục Bán lẻ tại Việt Nam.
Nhiệm vụ: Dịch nội dung Tiếng Việt sang đủ 5 ngôn ngữ: Tiếng Việt (vi), Tiếng Anh (en), Tiếng Hàn (ko), Tiếng Nhật (ja), và Tiếng Trung Giản Thể (zh).
Quy tắc:
1. Ngành của cửa hàng: "${vertical}".
2. Với món ăn Việt Nam đặc trưng (VD: Bạc xỉu, Phở tái nạm, Bún chả), dịch tên món kèm giải thích ngắn gọn nguyên liệu để khách nước ngoài hiểu ngay.
3. Nếu mô tả tiếng Việt (itemDescVi) trống, tự động viết 1 câu mô tả hấp dẫn ngắn gọn (dưới 18 từ) bằng cả 5 ngôn ngữ.
4. CHỈ TRẢ VỀ ĐÚNG 1 OBJECT JSON hợp lệ theo cấu trúc:
{
  "category_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." },
  "name_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." },
  "desc_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." }
}`;

    const parsed = await call9RouterJson<TranslationAiResponse>([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({ categoryNameVi, itemNameVi, itemDescVi }),
      },
    ]);

    if (!parsed?.name_i18n?.en || !parsed?.desc_i18n?.en) {
      throw new Error('Incomplete translation fields from 9router');
    }

    return NextResponse.json({
      ...parsed,
      provider: `9router-${aiConfig.model}`,
    });
  } catch (error) {
    console.error('9router Translation Error, using smart fallback:', error);
    const fallback = smartFallbackTranslate({
      vertical,
      categoryNameVi,
      itemNameVi: itemNameVi || 'Món đặc trưng',
      itemDescVi,
    });
    return NextResponse.json({
      ...fallback,
      provider: '9router-smart-fallback',
    });
  }
}
