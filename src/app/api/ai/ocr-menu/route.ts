import { NextResponse } from 'next/server';
import { call9RouterJson, getAiConfig, getDemoOcrResult } from '@/lib/gemini';
import { BusinessVertical, I18nText } from '@/types/qlaok';

interface OcrAiResponse {
  categories: Array<{
    name_i18n: I18nText;
    items: Array<{
      price: number;
      duration_mins?: number | null;
      name_i18n: I18nText;
      desc_i18n: I18nText;
    }>;
  }>;
}

export async function POST(req: Request) {
  let vertical: BusinessVertical = 'fnb';

  try {
    const body = await req.json();
    const {
      imageBase64,
      mimeType = 'image/webp',
      useDemo = false,
    } = body as {
      imageBase64?: string;
      mimeType?: string;
      vertical?: BusinessVertical;
      useDemo?: boolean;
    };
    vertical = body.vertical || 'fnb';

    const aiConfig = getAiConfig();

    if (useDemo || !aiConfig || !imageBase64) {
      const demoData = getDemoOcrResult(vertical);
      return NextResponse.json({
        ...demoData,
        provider: 'local-demo-ocr',
      });
    }

    const dataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:${mimeType};base64,${imageBase64}`;

    const prompt = `Hãy đọc hình ảnh menu / bảng giá này của cửa hàng thuộc lĩnh vực "${vertical}".
Trích xuất toàn bộ danh mục (categories) và các món/dịch vụ (items) bên trong.
Quy tắc xử lý giá tiền:
- Nếu giá trên menu ghi dạng rút gọn như "35k", "35.000", hoặc "35", hãy quy đổi chuẩn về số nguyên VNĐ là 35000.
- Dịch tên danh mục, tên món và mô tả sang đủ 5 ngôn ngữ (vi, en, ko, ja, zh).
CHỈ TRẢ VỀ JSON hợp lệ theo cấu trúc:
{
  "categories": [
    {
      "name_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." },
      "items": [
        {
          "price": 35000,
          "duration_mins": null,
          "name_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." },
          "desc_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." }
        }
      ]
    }
  ]
}`;

    const parsed = await call9RouterJson<OcrAiResponse>([
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]);

    if (!parsed?.categories || !Array.isArray(parsed.categories)) {
      throw new Error('Invalid OCR categories structure from 9router');
    }

    return NextResponse.json({
      ...parsed,
      provider: `9router-${aiConfig.model}`,
    });
  } catch (error) {
    console.error('9router OCR Error, falling back to demo OCR extraction:', error);
    const demoData = getDemoOcrResult(vertical);
    return NextResponse.json({
      ...demoData,
      provider: '9router-ocr-fallback',
    });
  }
}
