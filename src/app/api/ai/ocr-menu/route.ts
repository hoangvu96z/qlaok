import { NextResponse } from 'next/server';
import { getDemoOcrResult, getGeminiClient, Type } from '@/lib/gemini';
import { BusinessVertical } from '@/types/qlaok';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      imageBase64,
      mimeType = 'image/webp',
      vertical = 'fnb',
      useDemo = false,
    } = body as {
      imageBase64?: string;
      mimeType?: string;
      vertical?: BusinessVertical;
      useDemo?: boolean;
    };

    const ai = getGeminiClient();

    if (useDemo || !ai || !imageBase64) {
      const demoData = getDemoOcrResult(vertical);
      return NextResponse.json({
        ...demoData,
        provider: 'local-demo-ocr',
      });
    }

    const cleanBase64 = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const prompt = `
Hãy đọc hình ảnh menu / bảng giá này của cửa hàng thuộc lĩnh vực "${vertical}".
Trích xuất toàn bộ danh mục (categories) và các món/dịch vụ (items) bên trong.
Quy tắc xử lý giá tiền:
- Nếu giá trên menu ghi dạng rút gọn như "35k", "35.000", hoặc "35", hãy quy đổi chuẩn về số nguyên VNĐ là 35000.
- Đồng thời dịch luôn tên danh mục, tên món và mô tả sang 5 ngôn ngữ (vi, en, ko, ja, zh).
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { inlineData: { data: cleanBase64, mimeType } },
        { text: prompt },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
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
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        price: { type: Type.NUMBER },
                        duration_mins: { type: Type.NUMBER, nullable: true },
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
                      required: ['price', 'name_i18n', 'desc_i18n'],
                    },
                  },
                },
                required: ['name_i18n', 'items'],
              },
            },
          },
          required: ['categories'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return NextResponse.json({
      ...parsed,
      provider: 'gemini-2.5-flash',
    });
  } catch (error) {
    console.error('OCR Error, falling back to demo OCR extraction:', error);
    const demoData = getDemoOcrResult('fnb');
    return NextResponse.json({
      ...demoData,
      provider: 'local-demo-ocr-fallback',
    });
  }
}
