import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';
import {
  call9RouterJson,
  getAiConfig,
  getDemoOcrResult,
  parseRawOcrTextFallback,
  smartFallbackTranslate,
} from '@/lib/gemini';
import { BusinessVertical, I18nText } from '@/types/qlaok';

interface OcrAiResponse {
  categories: Array<{
    name_i18n: I18nText;
    items: Array<{
      price: number;
      duration_mins?: number | null;
      name_i18n: I18nText;
      desc_i18n?: I18nText;
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
        provider: 'demo-ocr',
      });
    }

    extractedText = (rawOcrText || '').trim();

    // If client did not send pre-extracted OCR text, run OCR on the server from imageBase64
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
            'Không nhận diện được chữ trên ảnh. Vui lòng chọn ảnh chụp rõ chữ hơn hoặc chỉnh sửa văn bản bên dưới.',
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
        provider: 'local-dictionary',
      });
    }

    const prompt = `Đọc thực đơn/bảng giá thuộc lĩnh vực "${vertical}" từ văn bản OCR (và ảnh nếu có) bên dưới:
"""
${extractedText}
"""

Yêu cầu bắt buộc:
1. Nếu thực đơn có nhiều cột khiến 1 dòng OCR chứa 2-3 món + giá liền nhau (ví dụ: "CA PHE DEN 25K VAI 25K"), hãy TÁCH RIÊNG từng món và giá tương ứng, đồng thời loại bỏ món bị lặp.
2. Khôi phục chuẩn dấu Tiếng Việt cho tên danh mục và tên món (ví dụ: "CA PHE DEN" -> "Cà Phê Đen", "BAC XIU" -> "Bạc Xỉu", "DAO CAM SA" -> "Trà Đào Cam Sả").
3. Quy đổi giá tiền về số nguyên VNĐ (ví dụ: "25K", "25.000", "25" -> 25000).
4. Dịch tên danh mục và tên món sang 5 ngôn ngữ: vi, en, ko, ja, zh.
5. CHỈ TRẢ VỀ JSON gọn nhẹ đúng cấu trúc sau (không giải thích thêm):
{
  "categories": [
    {
      "name_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." },
      "items": [
        {
          "price": 25000,
          "duration_mins": null,
          "name_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "..." }
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
      throw new Error('Invalid OCR categories structure');
    }

    // Ensure every extracted item has complete 5-language desc_i18n
    const enrichedCategories = parsed.categories
      .map((cat) => ({
        name_i18n: cat.name_i18n,
        items: (cat.items || []).map((item) => {
          const fallback = smartFallbackTranslate({
            vertical,
            itemNameVi: item.name_i18n?.vi || 'Món đặc trưng',
          });
          return {
            price: Number(item.price) || 0,
            duration_mins:
              item.duration_mins ?? (vertical === 'service' ? 60 : null),
            name_i18n: {
              vi: item.name_i18n?.vi || fallback.name_i18n.vi,
              en: item.name_i18n?.en || fallback.name_i18n.en,
              ko: item.name_i18n?.ko || fallback.name_i18n.ko,
              ja: item.name_i18n?.ja || fallback.name_i18n.ja,
              zh: item.name_i18n?.zh || fallback.name_i18n.zh,
            },
            desc_i18n:
              item.desc_i18n && item.desc_i18n.vi
                ? item.desc_i18n
                : fallback.desc_i18n,
          };
        }),
      }))
      .filter((c) => c.items.length > 0);

    if (enrichedCategories.length === 0) {
      throw new Error('Empty OCR categories');
    }

    return NextResponse.json({
      categories: enrichedCategories,
      rawOcrText: extractedText,
      provider: 'ai-vision',
    });
  } catch (error) {
    console.error('OCR AI Error:', error);
    if (extractedText) {
      const parsedFromOcr = parseRawOcrTextFallback(extractedText, vertical);
      if (parsedFromOcr.categories[0]?.items.length > 0) {
        return NextResponse.json({
          ...parsedFromOcr,
          rawOcrText: extractedText,
          provider: 'local-parser',
        });
      }
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Lỗi phân tích thực đơn: ${error.message}`
            : 'Không thể phân tích văn bản thực đơn từ ảnh.',
        rawOcrText: extractedText,
      },
      { status: 500 }
    );
  }
}

