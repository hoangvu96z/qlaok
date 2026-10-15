'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import imageCompression from 'browser-image-compression';
import Tesseract from 'tesseract.js';
import {
  ScanLine,
  Upload,
  Sparkles,
  Check,
  Loader2,
  Trash2,
  FileImage,
  FileText,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { I18nText } from '@/types/qlaok';
import { ALL_LOCALES } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';

interface ExtractedItem {
  price: number;
  duration_mins?: number | null;
  name_i18n: I18nText;
  desc_i18n: I18nText;
}

interface ExtractedCategory {
  name_i18n: I18nText;
  items: ExtractedItem[];
}

export default function DashboardAiScannerPage() {
  const router = useRouter();
  const { activeShop } = useDashboard();

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [compressedInfo, setCompressedInfo] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [scanStepText, setScanStepText] = useState<string>('');
  const [rawOcrText, setRawOcrText] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [extractedCategories, setExtractedCategories] = useState<
    ExtractedCategory[]
  >([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!activeShop) return null;

  const analyzeTextWithAi = async (
    textToAnalyze: string,
    imgBase64?: string | null
  ) => {
    setScanStepText(
      'Bước 2/2: Đang phân loại danh mục, chuẩn hóa giá tiền & dịch tự động sang 5 ngôn ngữ...'
    );
    const res = await fetch('/api/ai/ocr-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: imgBase64 ?? previewImage ?? undefined,
        mimeType: 'image/webp',
        rawOcrText: textToAnalyze,
        vertical: activeShop.vertical,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Không thể bóc tách menu tự động');
    }
    setExtractedCategories(data.categories || []);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setSuccessMsg('');
    setScanning(true);
    setExtractedCategories([]);

    try {
      setScanStepText('Đang tối ưu độ nét ảnh thực đơn...');
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.6,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
        fileType: 'image/webp',
      });

      const kb = Math.round(compressed.size / 1024);
      setCompressedInfo(
        `Đã chuẩn hóa ảnh: ${kb} KB (Gốc: ${Math.round(file.size / 1024)} KB)`
      );

      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });

      setPreviewImage(base64);

      setScanStepText('Bước 1/2: Đang nhận diện chữ Tiếng Việt trên ảnh...');
      const ocrResult = await Tesseract.recognize(compressed, 'vie+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            setScanStepText(
              `Bước 1/2: Đang đọc nội dung thực đơn trên ảnh (${pct}%)...`
            );
          }
        },
      });

      const recognizedText = (ocrResult.data.text || '').trim();
      setRawOcrText(recognizedText);

      if (!recognizedText) {
        throw new Error(
          'Không nhận diện được chữ nào trên ảnh. Vui lòng chọn ảnh rõ nét hơn hoặc gõ/dán thực đơn vào ô văn bản bên dưới.'
        );
      }

      await analyzeTextWithAi(recognizedText, base64);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Lỗi khi quét ảnh menu'
      );
    } finally {
      setScanning(false);
      setScanStepText('');
    }
  };

  const handleReanalyzeRawText = async () => {
    if (!rawOcrText.trim()) return;
    setErrorMsg('');
    setSuccessMsg('');
    setScanning(true);
    try {
      await analyzeTextWithAi(rawOcrText.trim());
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Lỗi khi phân tích văn bản'
      );
    } finally {
      setScanning(false);
      setScanStepText('');
    }
  };

  const handleRunDemoScan = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setScanning(true);
    const sampleTextByVertical =
      activeShop.vertical === 'service'
        ? `BẢNG GIÁ DỊCH VỤ SPA & NAIL\nGội đầu dưỡng sinh thảo dược 70 phút - 199k\nMassage cổ vai gáy đá nóng 60 phút - 250.000đ\nSơn gel Hàn Quốc cao cấp 45 phút - 150k`
        : activeShop.vertical === 'retail'
          ? `ĐẶC SẢN QUÀ BIẾU\nXoài sấy dẻo muối ớt (Hộp 300g) - 95k\nTrà sâm dứa hoa nhài Hội An (Gói 500g) - 110.000đ`
          : `MÓN CHÍNH\nPhở bò tái nạm đặc biệt - 55k\nBánh mì thịt nướng sả ớt Hội An - 35.000đ\nĐỒ UỐNG\nCà phê muối Huế - 29k\nTrà đào cam sả - 35k`;

    setRawOcrText(sampleTextByVertical);
    setCompressedInfo(
      'Đang phân tích thực đơn mẫu & dịch tự động 5 ngôn ngữ...'
    );
    try {
      await analyzeTextWithAi(sampleTextByVertical);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không thể phân tích dữ liệu mẫu.'
      );
    } finally {
      setScanning(false);
      setScanStepText('');
    }
  };

  const handleUpdateExtractedItem = (
    catIdx: number,
    itemIdx: number,
    field: 'viName' | 'price' | 'duration',
    value: string
  ) => {
    setExtractedCategories((prev) => {
      const next = structuredClone(prev);
      const item = next[catIdx].items[itemIdx];
      if (field === 'viName') {
        item.name_i18n.vi = value;
      } else if (field === 'price') {
        item.price = Number(value.replace(/[^\d]/g, '')) || 0;
      } else if (field === 'duration') {
        item.duration_mins = value ? Number(value) : null;
      }
      return next;
    });
  };

  const handleRemoveExtractedItem = (catIdx: number, itemIdx: number) => {
    setExtractedCategories((prev) => {
      const next = structuredClone(prev);
      next[catIdx].items.splice(itemIdx, 1);
      return next.filter((c) => c.items.length > 0);
    });
  };

  const handleSaveAllToShop = async () => {
    if (extractedCategories.length === 0) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_import',
          shopId: activeShop.id,
          categories: extractedCategories,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lỗi khi lưu vào cửa hàng');
      }

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({ type: 'bulk_imported' });
        bc.close();
      }

      setSuccessMsg(
        `Đã thêm thành công ${data.createdItems?.length || 0} món mới (đủ 5 ngôn ngữ) vào cửa hàng!`
      );
      setTimeout(() => {
        router.push('/dashboard/catalog');
      }, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu menu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800 mb-2">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Trí Tuệ Nhân Tạo • Quét Thực Đơn Tự Động</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          Chụp Ảnh Menu Giấy → Tạo Menu 5 Ngôn Ngữ Tự Động
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Tải lên ảnh chụp thực đơn ép plastic, bảng giá tiệm Nail/Spa hoặc ảnh chụp màn hình GrabFood. Hệ thống tự động đọc tên món Tiếng Việt trên ảnh, phân loại Danh mục, quy đổi giá tiền (<code className="font-mono">35k → 35.000đ</code>) và dịch sang Việt, Anh, Hàn, Nhật, Trung.
        </p>
      </div>

      {/* Upload / Demo Trigger Card */}
      <div className="rounded-3xl border-2 border-dashed border-emerald-400 bg-emerald-50/40 p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
          <ScanLine className="h-7 w-7" />
        </div>

        <div className="space-y-1">
          <h3 className="text-base font-extrabold text-slate-900">
            Tải lên ảnh chụp Menu / Bảng giá của quán ({activeShop.name})
          </h3>
          <p className="text-xs text-slate-500">
            Tự động bóc tách danh sách món ăn, nhận diện giá tiền &amp; dịch chuẩn ngữ cảnh 5 thứ tiếng
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-500 active:scale-95">
            <Upload className="h-4 w-4" />
            <span>Chọn Ảnh Menu Từ Máy / Điện Thoại</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={handleRunDemoScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-xs font-bold text-slate-800 shadow-2xs hover:bg-slate-50 active:scale-95"
          >
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span>Thử Nhanh Với Thực Đơn Mẫu</span>
          </button>
        </div>

        {compressedInfo && (
          <p className="text-xs font-semibold text-emerald-700">
            <FileImage className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
            {compressedInfo}
          </p>
        )}
      </div>

      {/* Raw OCR Text Inspection & Manual Edit Box */}
      {(rawOcrText || previewImage) && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-600" />
              <h3 className="text-xs sm:text-sm font-black text-slate-900">
                Nội dung chữ đọc được từ ảnh (Có thể sửa trực tiếp rồi bấm Phân tích lại)
              </h3>
            </div>
            <button
              type="button"
              onClick={handleReanalyzeRawText}
              disabled={scanning || !rawOcrText.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>Phân Tích Lại</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewImage && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewImage}
                  alt="Ảnh menu đã chọn"
                  className="max-h-48 w-auto rounded-xl object-contain"
                />
              </div>
            )}
            <div className={previewImage ? 'md:col-span-2' : 'md:col-span-3'}>
              <textarea
                rows={5}
                value={rawOcrText}
                onChange={(e) => setRawOcrText(e.target.value)}
                placeholder="Văn bản quét từ ảnh sẽ hiện tại đây, hoặc bạn có thể dán trực tiếp danh sách món + giá vào đây..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {scanning && (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center space-y-3">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-600" />
          <p className="text-sm font-bold text-slate-900">
            {scanStepText ||
              'Đang phân tích thực đơn và dịch tự động sang 5 ngôn ngữ...'}
          </p>
          <p className="text-xs text-slate-500">
            Hệ thống đang bóc tách tên món, giá tiền và dịch sang 5 thứ tiếng (khoảng 5–15 giây).
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          ✅ {successMsg}
        </div>
      )}

      {/* Preview & Inline Edit Extracted Categories & Items */}
      {extractedCategories.length > 0 && !scanning && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-white">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-black">
                  📋 Kết quả bóc tách thực đơn ({extractedCategories.reduce((s, c) => s + c.items.length, 0)} món/dịch vụ)
                </h2>
              </div>
              <p className="text-xs text-slate-300">
                Kiểm tra lại tên và giá bên dưới trước khi lưu toàn bộ vào cửa hàng
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveAllToShop}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang lưu vào quán...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Lưu Toàn Bộ Vào Cửa Hàng</span>
                </>
              )}
            </button>
          </div>

          {extractedCategories.map((cat, catIdx) => (
            <div
              key={catIdx}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
            >
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                  Danh mục bóc tách #{catIdx + 1}
                </span>
                <h3 className="text-base font-black text-slate-900">
                  {cat.name_i18n.vi}
                </h3>
                <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500">
                  {ALL_LOCALES.filter((l) => l !== 'vi').map((loc) => (
                    <span key={loc} className="inline-flex items-center gap-1.5">
                      <FlagIcon locale={loc} className="h-3.5 w-5" />
                      <span>{cat.name_i18n[loc]}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {cat.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                          Tên món / dịch vụ (Tiếng Việt)
                        </label>
                        <input
                          type="text"
                          value={item.name_i18n.vi}
                          onChange={(e) =>
                            handleUpdateExtractedItem(
                              catIdx,
                              itemIdx,
                              'viName',
                              e.target.value
                            )
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="w-full sm:w-36">
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                          Giá (VNĐ)
                        </label>
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) =>
                            handleUpdateExtractedItem(
                              catIdx,
                              itemIdx,
                              'price',
                              e.target.value
                            )
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-emerald-700 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      {activeShop.vertical === 'service' && (
                        <div className="w-full sm:w-28">
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                            Phút
                          </label>
                          <input
                            type="number"
                            value={item.duration_mins || ''}
                            onChange={(e) =>
                              handleUpdateExtractedItem(
                                catIdx,
                                itemIdx,
                                'duration',
                                e.target.value
                              )
                            }
                            placeholder="60"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
                          />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleRemoveExtractedItem(catIdx, itemIdx)}
                        className="self-end sm:self-center flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-rose-600"
                        title="Bỏ món này"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* 4 Auto-Translated Languages Preview */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-[11px] text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <FlagIcon locale="en" className="h-3.5 w-5" />
                        <span>
                          <strong>EN:</strong> {item.name_i18n.en}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FlagIcon locale="ko" className="h-3.5 w-5" />
                        <span>
                          <strong>KO:</strong> {item.name_i18n.ko}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FlagIcon locale="ja" className="h-3.5 w-5" />
                        <span>
                          <strong>JA:</strong> {item.name_i18n.ja}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FlagIcon locale="zh" className="h-3.5 w-5" />
                        <span>
                          <strong>ZH:</strong> {item.name_i18n.zh}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
