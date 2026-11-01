import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';
import {
  call9RouterJson,
  getAiConfig,
  getDemoOcrResult,
  parseRawOcrTextFallback,
  smartFallbackTranslate,
} from '@/lib/gemini';
import type { BusinessVertical, I18nText } from '@/types/qlaok';
import { requireAiCaller, requireAiOcrPlan } from '../_lib/guard';

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

const MAX_OCR_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_OCR_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OCR_IMAGE_DIMENSION = 8192;
const MAX_OCR_IMAGE_PIXELS = 16 * 1024 * 1024;
const MAX_OCR_TEXT_CHARS = 20_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class OcrRequestError extends Error {
  readonly status: 400 | 413;
  readonly code: 'INVALID_JSON' | 'OCR_REQUEST_TOO_LARGE' | 'INVALID_OCR_INPUT';

  constructor(
    status: 400 | 413,
    code: 'INVALID_JSON' | 'OCR_REQUEST_TOO_LARGE' | 'INVALID_OCR_INPUT'
  ) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function readOcrJsonRequest(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new OcrRequestError(400, 'INVALID_JSON');

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_OCR_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new OcrRequestError(413, 'OCR_REQUEST_TOO_LARGE');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new OcrRequestError(400, 'INVALID_JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OcrRequestError(400, 'INVALID_JSON');
  }
  return parsed as Record<string, unknown>;
}

function normalizeOcrImageBase64(
  imageBase64: string,
  mimeType: string
): { base64: string; mimeType: string } {
  const match = /^(?:data:(image\/(?:png|jpeg|webp));base64,)?([A-Za-z0-9+/]+={0,2})$/.exec(
    imageBase64.trim()
  );
  if (!match) throw new OcrRequestError(400, 'INVALID_OCR_INPUT');

  const normalizedMimeType = match[1] || mimeType;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(normalizedMimeType)) {
    throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
  }
  const base64 = match[2];
  if (base64.length > 4 * Math.ceil(MAX_OCR_IMAGE_BYTES / 3)) {
    throw new OcrRequestError(413, 'OCR_REQUEST_TOO_LARGE');
  }
  const imageBuffer = Buffer.from(base64, 'base64');
  if (imageBuffer.byteLength === 0) {
    throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
  }
  if (imageBuffer.toString('base64') !== base64) {
    throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
  }
  if (imageBuffer.byteLength > MAX_OCR_IMAGE_BYTES) {
    throw new OcrRequestError(413, 'OCR_REQUEST_TOO_LARGE');
  }
  const dimensions = readOcrImageDimensions(imageBuffer, normalizedMimeType);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
  }
  if (
    dimensions.width > MAX_OCR_IMAGE_DIMENSION ||
    dimensions.height > MAX_OCR_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_OCR_IMAGE_PIXELS
  ) {
    throw new OcrRequestError(413, 'OCR_REQUEST_TOO_LARGE');
  }
  return { base64, mimeType: normalizedMimeType };
}

function readOcrImageDimensions(
  image: Buffer,
  mimeType: string
): { width: number; height: number } | null {
  if (mimeType === 'image/png') {
    if (
      image.byteLength < 33 ||
      !image.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE) ||
      image.readUInt32BE(8) !== 13 ||
      image.toString('ascii', 12, 16) !== 'IHDR'
    ) {
      return null;
    }
    return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  }

  if (mimeType === 'image/jpeg') {
    if (image.byteLength < 4 || image[0] !== 0xff || image[1] !== 0xd8) {
      return null;
    }
    let offset = 2;
    for (let segments = 0; segments < 256 && offset < image.byteLength; segments++) {
      if (image[offset] !== 0xff) return null;
      while (offset < image.byteLength && image[offset] === 0xff) offset++;
      if (offset >= image.byteLength) return null;

      const marker = image[offset++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        continue;
      }
      if (offset + 2 > image.byteLength) return null;

      const segmentLength = image.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > image.byteLength) {
        return null;
      }
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        if (segmentLength < 8) return null;
        return {
          height: image.readUInt16BE(offset + 3),
          width: image.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength;
    }
    return null;
  }

  if (
    mimeType !== 'image/webp' ||
    image.byteLength < 20 ||
    image.toString('ascii', 0, 4) !== 'RIFF' ||
    image.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const riffEnd = image.readUInt32LE(4) + 8;
  if (riffEnd < 20 || riffEnd > image.byteLength) return null;
  let offset = 12;
  for (let chunks = 0; chunks < 256 && offset + 8 <= riffEnd; chunks++) {
    const chunkType = image.toString('ascii', offset, offset + 4);
    const chunkLength = image.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength;
    const nextOffset = chunkEnd + (chunkLength % 2);
    if (chunkEnd > riffEnd || nextOffset > riffEnd) return null;

    if (chunkType === 'VP8X') {
      if (chunkLength < 10) return null;
      return {
        width: 1 + image.readUIntLE(dataOffset + 4, 3),
        height: 1 + image.readUIntLE(dataOffset + 7, 3),
      };
    }
    if (chunkType === 'VP8L') {
      if (chunkLength < 5 || image[dataOffset] !== 0x2f) return null;
      return {
        width: 1 + image[dataOffset + 1] + ((image[dataOffset + 2] & 0x3f) << 8),
        height:
          1 +
          (image[dataOffset + 2] >> 6) +
          (image[dataOffset + 3] << 2) +
          ((image[dataOffset + 4] & 0x0f) << 10),
      };
    }
    if (chunkType === 'VP8 ') {
      if (
        chunkLength < 10 ||
        image[dataOffset + 3] !== 0x9d ||
        image[dataOffset + 4] !== 0x01 ||
        image[dataOffset + 5] !== 0x2a
      ) {
        return null;
      }
      return {
        width: image.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: image.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    offset = nextOffset;
  }
  return null;
}

export async function POST(req: Request) {
  // Paid AI endpoint: require a verified session and apply per-user rate limit
  const guard = await requireAiCaller(req, 'ocr');
  if (guard.errorResponse) return guard.errorResponse;

  let vertical: BusinessVertical = 'fnb';
  let extractedText = '';

  try {
    const body = await readOcrJsonRequest(req);
    const {
      imageBase64: rawImageBase64,
      mimeType: requestedMimeType = 'image/webp',
      rawOcrText: requestedOcrText,
      useDemo = false,
    } = body;
    if (
      (rawImageBase64 !== undefined && typeof rawImageBase64 !== 'string') ||
      (requestedOcrText !== undefined && typeof requestedOcrText !== 'string') ||
      typeof requestedMimeType !== 'string'
    ) {
      throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
    }
    if (
      typeof requestedOcrText === 'string' &&
      requestedOcrText.length > MAX_OCR_TEXT_CHARS
    ) {
      throw new OcrRequestError(413, 'OCR_REQUEST_TOO_LARGE');
    }
    const image = rawImageBase64
      ? normalizeOcrImageBase64(rawImageBase64, requestedMimeType)
      : null;
    const requestedVertical = body.vertical;
    if (
      requestedVertical !== undefined &&
      (typeof requestedVertical !== 'string' ||
        !['fnb', 'service', 'retail'].includes(requestedVertical))
    ) {
      throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
    }
    if (useDemo !== undefined && typeof useDemo !== 'boolean') {
      throw new OcrRequestError(400, 'INVALID_OCR_INPUT');
    }
    vertical = (requestedVertical || 'fnb') as BusinessVertical;
    const rawShopId =
      body.shopId !== undefined
        ? body.shopId
        : body.shop_id !== undefined
          ? body.shop_id
          : (new URL(req.url).searchParams.get('shopId') ?? undefined);

    if (useDemo) {
      const demoData = getDemoOcrResult(vertical);
      return NextResponse.json({
        ...demoData,
        provider: 'demo-ocr',
      });
    }

    // Server-side plan gate: real OCR / AI Vision requires a plan with allowAiOcr on the active authorized shop owner
    const planLock = await requireAiOcrPlan(guard.user, {
      shopId: rawShopId,
    });
    if (planLock) return planLock;

    extractedText = (requestedOcrText || '').trim();

    // If client did not send pre-extracted OCR text, run OCR on the server from imageBase64
    if (!extractedText && image) {
      const imageBuffer = Buffer.from(image.base64, 'base64');
      const ocrResult = await Tesseract.recognize(imageBuffer, 'vie+eng');
      extractedText = (ocrResult.data.text || '').trim().slice(0, MAX_OCR_TEXT_CHARS);
    }

    if (!extractedText && !image) {
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

    const userContent = image
      ? [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${image.base64}`,
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

    // Ensure every extracted item has complete 8-language name_i18n and desc_i18n
    const enrichedCategories = parsed.categories
      .map((cat) => {
        const catFallback = smartFallbackTranslate({
          vertical,
          categoryNameVi: cat.name_i18n?.vi || 'Thực đơn',
          itemNameVi: 'Món',
        });
        return {
          name_i18n: {
            ...catFallback.category_i18n,
            ...cat.name_i18n,
          },
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
                es: item.name_i18n?.es || fallback.name_i18n.es,
                it: item.name_i18n?.it || fallback.name_i18n.it,
                ru: item.name_i18n?.ru || fallback.name_i18n.ru,
              },
              desc_i18n:
                item.desc_i18n && item.desc_i18n.vi
                  ? { ...fallback.desc_i18n, ...item.desc_i18n }
                  : fallback.desc_i18n,
            };
          }),
        };
      })
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
    if (error instanceof OcrRequestError) {
      return NextResponse.json(
        {
          code: error.code,
          error:
            error.status === 413
              ? 'Ảnh hoặc văn bản OCR vượt quá giới hạn cho phép.'
              : 'Dữ liệu yêu cầu OCR không hợp lệ.',
        },
        { status: error.status }
      );
    }
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

