import { NextResponse } from 'next/server';
import { getGeminiClient, smartFallbackTranslate, Type } from '@/lib/gemini';
import { BusinessVertical } from '@/types/qlaok';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      vertical = 'fnb',
      categoryNameVi = 'Danh mục',
      itemNameVi = '',
      itemDescVi = '',
    } = body as {
      vertical?: BusinessVertical;
      categoryNameVi?: string;
      itemNameVi: string;
      itemDescVi?: string;
    };

    if (!itemNameVi || !itemNameVi.trim()) {
      return NextResponse.json(
        { error: 'Vui lòng nhập tên món / dịch vụ bằng Tiếng Việt' },
        { status: 400 }
      );
    }

    const ai = getGeminiClient();

    if (!ai) {
      // Local smart culinary/service fallback when GEMINI_API_KEY is not configured
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

    const systemInstruction = `
Bạn là chuyên gia bản địa hóa Menu Ẩm thực (F&B), Bảng giá Dịch vụ (Nail, Spa, Massage, Gym, Giặt sấy) và Danh mục Bán lẻ tại Việt Nam.
Nhiệm vụ: Dịch nội dung Tiếng Việt sang 4 ngôn ngữ: Tiếng Anh (en), Tiếng Hàn (ko), Tiếng Nhật (ja), và Tiếng Trung Giản Thể (zh).
Quy tắc dịch:
1. Ngành hiện tại của cửa hàng là: "${vertical}".
2. Với món ăn Việt Nam đặc trưng (VD: Bạc xỉu, Phở tái nạm, Bún chả, Bánh tráng trộn), hãy dịch tên món kèm giải thích ngắn gọn bản chất nguyên liệu để khách nước ngoài hiểu ngay (VD: "Bạc xỉu" -> en: "Vietnamese Sweetened Condensed Milk Coffee (Bac Xiu)", ko: "연유가 듬뿍 들어간 베트남식 달콤한 라떼 (박씨우)").
3. Với ngành Dịch vụ (Nail, Spa, Gội đầu dưỡng sinh), dùng đúng thuật ngữ bản xứ mà khách Hàn/Nhật/Trung hay tìm kiếm (VD: "Gội đầu dưỡng sinh" -> ko: "베트남식 두피 케어 & 힐링 샴푸", en: "Herbal Relaxing Head Spa & Massage").
4. Nếu mô tả tiếng Việt (itemDescVi) bị bỏ trống, hãy tự động viết một câu mô tả hấp dẫn ngắn gọn (dưới 18 từ) bằng cả 5 ngôn ngữ dựa trên tên món/dịch vụ.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: JSON.stringify({ categoryNameVi, itemNameVi, itemDescVi }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category_i18n: {
              type: Type.OBJECT,
              properties: {
                vi: { type: Type.STRING },
                en: { type: Type.STRING },
                ko: { type: Type.STRING },
                ja: { type: Type.STRING },
                zh: { type: Type.STRING },
              },
              required: ['vi', 'en', 'ko', 'ja', 'zh'],
            },
            name_i18n: {
              type: Type.OBJECT,
              properties: {
                vi: { type: Type.STRING },
                en: { type: Type.STRING },
                ko: { type: Type.STRING },
                ja: { type: Type.STRING },
                zh: { type: Type.STRING },
              },
              required: ['vi', 'en', 'ko', 'ja', 'zh'],
            },
            desc_i18n: {
              type: Type.OBJECT,
              properties: {
                vi: { type: Type.STRING },
                en: { type: Type.STRING },
                ko: { type: Type.STRING },
                ja: { type: Type.STRING },
                zh: { type: Type.STRING },
              },
              required: ['vi', 'en', 'ko', 'ja', 'zh'],
            },
          },
          required: ['name_i18n', 'desc_i18n'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return NextResponse.json({
      ...parsed,
      provider: 'gemini-2.5-flash',
    });
  } catch (error) {
    console.error('Translation Error, using smart fallback:', error);
    const fallback = smartFallbackTranslate({
      vertical: 'fnb',
      itemNameVi: 'Món đặc trưng',
    });
    return NextResponse.json({
      ...fallback,
      provider: 'local-smart-dictionary-fallback',
    });
  }
}
