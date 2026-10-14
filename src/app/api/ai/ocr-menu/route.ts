import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';
import {
  call9RouterJson,
  getAiConfig,
  getDemoOcrResult,
  parseRawOcrTextFallback,
} from '@/lib/gemini';
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
  let extractedText = '';

  try {
    const body = await req.json();
    const {
      imageBase64,
      mimeType = 'image/webp',
      rawOcrText,
      useDemo = false,
    } = body as {
      imageBase64?: string;
      mimeType?: string;
      rawOcrText?: string;
      vertical?: BusinessVertical;
      useDemo?: boolean;
    };
    vertical = body.vertical || 'fnb';

    if (useDemo) {
      const demoData = getDemoOcrResult(vertical);
      return NextResponse.json({
        ...demoData,
        provider: 'local-demo-ocr',
      });
    }

    extractedText = (rawOcrText || '').trim();

    // If client did not send pre-extracted OCR text, run Tesseract OCR on the server from imageBase64
    if (!extractedText && imageBase64) {
      const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Clean, 'base64');
      const ocrResult = await Tesseract.recognize(imageBuffer, 'vie+eng');
      extractedText = (ocrResult.data.text || '').trim();
    }

    if (!extractedText && !imageBase64) {
      return NextResponse.json(
        {
          error:
            'Không nhận diện được chữ trên ảnh. Vui lòng chọn ảnh chụp rõ chữ hơn hoặc chỉnh sửa văn bản OCR bên dưới.',
        },
        { status: 400 }
      );
    }

    const aiConfig = getAiConfig();
    if (!aiConfig) {
      const fallbackParsed = parseRawOcrTextFallback(extractedText, vertical);
      return NextResponse.json({
        ...fallbackParsed,
        rawOcrText: extractedText,
        provider: 'tesseract-local-dictionary',
      });
    }

    const prompt = `Hãy đọc hình ảnh menu / bảng giá đính kèm (cùng văn bản OCR hỗ trợ bên dưới) của cửa hàng thuộc lĩnh vực "${vertical}":
"""
${extractedText}
"""

Nhiệm vụ của bạn:
1. Kết hợp hình ảnh và văn bản OCR ở trên, tự động sửa các lỗi nhận diện ký tự hoặc mất dấu tiếng Việt nhẹ.
2. Phân loại thành danh mục (categories) và danh sách các món/dịch vụ (items). Nếu văn bản không ghi rõ tên danh mục, hãy tự đặt tên danh mục phù hợp với các món.
3. Quy tắc xử lý giá tiền:
   - Nếu giá trên menu ghi dạng rút gọn như "35k", "35.000", "35,000", hoặc "35", hãy quy đổi chuẩn về số nguyên VNĐ là 35000.
   - Nếu một dòng món ăn không có giá rõ ràng, hãy ước lượng mức giá hợp lý hoặc đặt 0 để chủ quán sửa lại.
4. Dịch tên danh mục, tên món và viết 1 câu mô tả ngắn hấp dẫn sang đủ 5 ngôn ngữ: Tiếng Việt (vi), Tiếng Anh (en), Tiếng Hàn (ko), Tiếng Nhật (ja), và Tiếng Trung Giản Thể (zh).
5. CHỈ TRẢ VỀ JSON hợp lệ theo cấu trúc:
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

    const userContent = imageBase64
      ? [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: imageBase64.startsWith('data:')
                ? imageBase64
                : `data:${mimeType};base64,${imageBase64}`,
            },
          },
        ]
      : prompt;

    const parsed = await call9RouterJson<OcrAiResponse>(
      [
        {
          role: 'user',
          content: userContent,
        },
      ],
      aiConfig.visionModel
    );

    if (!parsed?.categories || !Array.isArray(parsed.categories)) {
      throw new Error('Invalid OCR categories structure from 9router AI');
    }

    return NextResponse.json({
      ...parsed,
      rawOcrText: extractedText,
      provider: `9router-${aiConfig.visionModel}`,
    });
  } catch (error) {
    console.error('9router OCR AI Error:', error);
    if (extractedText) {
      const parsedFromOcr = parseRawOcrTextFallback(extractedText, vertical);
      if (parsedFromOcr.categories[0]?.items.length > 0) {
        return NextResponse.json({
          ...parsedFromOcr,
          rawOcrText: extractedText,
          provider: 'tesseract-ocr-local-parser',
        });
      }
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Lỗi phân tích AI: ${error.message}`
            : 'Không thể phân tích văn bản thực đơn từ ảnh.',
        rawOcrText: extractedText,
      },
      { status: 500 }
    );
  }
}

