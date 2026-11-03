import { NextResponse } from 'next/server';
import {
  call9RouterJson,
  getAiConfig,
  smartFallbackTranslate,
} from '@/lib/gemini';
import type { BusinessVertical, I18nText } from '@/types/qlaok';
import { requireAiCaller } from '../_lib/guard';
import { requireShopPermission } from '@/lib/server-auth';

interface TranslationAiResponse {
  category_i18n?: I18nText;
  name_i18n: I18nText;
  desc_i18n: I18nText;
}

const MAX_TRANSLATION_REQUEST_BYTES = 20 * 1024;
const MAX_TRANSLATION_FIELD_LENGTHS = {
  categoryNameVi: 200,
  itemNameVi: 200,
  itemDescVi: 4000,
} as const;
const SUPPORTED_VERTICALS = new Set<BusinessVertical>([
  'fnb',
  'service',
  'retail',
]);

async function readBoundedTranslationJson(
  req: Request
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const invalidInput = () =>
    NextResponse.json(
      {
        error: 'Dữ liệu yêu cầu không hợp lệ.',
        code: 'INVALID_TRANSLATION_INPUT',
      },
      { status: 400 }
    );
  const oversizedInput = () =>
    NextResponse.json(
      {
        error: 'Nội dung yêu cầu dịch vượt quá giới hạn cho phép.',
        code: 'TRANSLATION_REQUEST_TOO_LARGE',
      },
      { status: 413 }
    );

  const declaredLength = req.headers.get('content-length')?.trim();
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) {
      return { ok: false, response: invalidInput() };
    }
    if (Number(declaredLength) > MAX_TRANSLATION_REQUEST_BYTES) {
      try {
        await req.body?.cancel();
      } catch {
        // Ignore stream cancellation errors.
      }
      return { ok: false, response: oversizedInput() };
    }
  }

  const reader = req.body?.getReader();
  if (!reader) return { ok: false, response: invalidInput() };

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_TRANSLATION_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Ignore stream cancellation errors.
        }
        return { ok: false, response: oversizedInput() };
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return { ok: false, response: invalidInput() };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore reader lock release errors.
    }
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.concat(chunks, totalBytes).toString('utf8')
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, response: invalidInput() };
    }
    return {
      ok: true,
      body: parsed as Record<string, unknown>,
    };
  } catch {
    return { ok: false, response: invalidInput() };
  }
}

export async function POST(req: Request) {
  // Paid AI endpoint: require a current session and apply per-user rate limit.
  const guard = await requireAiCaller(req, 'translate');
  if (guard.errorResponse) return guard.errorResponse;

  const parsedRequest = await readBoundedTranslationJson(req);
  if (!parsedRequest.ok) return parsedRequest.response;
  const { body } = parsedRequest;

  const shopId = typeof body.shopId === 'string' ? body.shopId.trim() : '';
  if (!shopId) {
    return NextResponse.json(
      { error: 'Thiếu mã cửa hàng (shopId).', code: 'SHOP_ID_REQUIRED' },
      { status: 400 }
    );
  }

  const verticalInput = body.vertical === undefined ? 'fnb' : body.vertical;
  if (
    typeof verticalInput !== 'string' ||
    !SUPPORTED_VERTICALS.has(verticalInput as BusinessVertical)
  ) {
    return NextResponse.json(
      {
        error: 'Ngành kinh doanh không hợp lệ.',
        code: 'INVALID_TRANSLATION_VERTICAL',
      },
      { status: 400 }
    );
  }

  for (const [field, maxLength] of Object.entries(
    MAX_TRANSLATION_FIELD_LENGTHS
  )) {
    const value = body[field];
    if (typeof value === 'string' && value.length > maxLength) {
      return NextResponse.json(
        {
          error: 'Nội dung dịch vượt quá độ dài cho phép.',
          code: 'TRANSLATION_FIELD_TOO_LONG',
          field,
          maxLength,
        },
        { status: 400 }
      );
    }
  }

  const purpose = body.purpose === undefined ? 'catalog' : body.purpose;
  if (purpose !== 'catalog' && purpose !== 'promotion') {
    return NextResponse.json(
      {
        error: 'Mục đích dịch không hợp lệ.',
        code: 'INVALID_TRANSLATION_PURPOSE',
      },
      { status: 400 }
    );
  }

  const permission = await requireShopPermission(
    req,
    shopId,
    purpose === 'promotion' ? 'promotions.manage' : 'catalog.manage'
  );
  if (permission.errorResponse) return permission.errorResponse;

  const vertical = verticalInput as BusinessVertical;
  const categoryNameVi =
    typeof body.categoryNameVi === 'string' && body.categoryNameVi.trim()
      ? body.categoryNameVi
      : 'Danh mục';
  const itemNameVi = typeof body.itemNameVi === 'string' ? body.itemNameVi : '';
  const itemDescVi = typeof body.itemDescVi === 'string' ? body.itemDescVi : '';

  try {
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
Nhiệm vụ: Dịch nội dung Tiếng Việt sang đủ 8 ngôn ngữ: Tiếng Việt (vi), Tiếng Anh (en), Tiếng Hàn (ko), Tiếng Nhật (ja), Tiếng Trung Giản Thể (zh), Tiếng Tây Ban Nha (es), Tiếng Ý (it), và Tiếng Nga (ru).
Quy tắc:
1. Ngành của cửa hàng: "${vertical}".
2. Với món ăn Việt Nam đặc trưng (VD: Bạc xỉu, Phở tái nạm, Bún chả), dịch tên món kèm giải thích ngắn gọn nguyên liệu để khách nước ngoài hiểu ngay.
3. Nếu mô tả tiếng Việt (itemDescVi) trống, tự động viết 1 câu mô tả hấp dẫn ngắn gọn (dưới 18 từ) bằng cả 8 ngôn ngữ.
4. CHỈ TRẢ VỀ ĐÚNG 1 OBJECT JSON hợp lệ theo cấu trúc:
{
  "category_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "...", "es": "...", "it": "...", "ru": "..." },
  "name_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "...", "es": "...", "it": "...", "ru": "..." },
  "desc_i18n": { "vi": "...", "en": "...", "ko": "...", "ja": "...", "zh": "...", "es": "...", "it": "...", "ru": "..." }
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
  } catch {
    console.error('ai.translation_fallback', {
      code: 'AI_TRANSLATION_PROVIDER_FAILED',
    });
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
