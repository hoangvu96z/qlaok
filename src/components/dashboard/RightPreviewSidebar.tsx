'use client';

import React from 'react';
import {
  Smartphone,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Eye,
} from 'lucide-react';
import type { CatalogItem, Shop } from '@/types/qlaok';
import { StorefrontPhonePreview } from '@/components/storefront/StorefrontCustomDecor';

interface RightPreviewSidebarProps {
  shop: Shop;
  items?: CatalogItem[];
  isOpen: boolean;
  onToggle: () => void;
  onOpenPopupPreview?: () => void;
  subtitle?: string;
  children?: React.ReactNode;
}

export function RightPreviewSidebar({
  shop,
  items = [],
  isOpen,
  onToggle,
  onOpenPopupPreview,
  subtitle = 'Hiển thị trực tiếp theo cài đặt đang chỉnh sửa',
  children,
}: RightPreviewSidebarProps) {
  return (
    <>
      {/* Mobile / Tablet Backdrop when drawer is open on smaller viewports */}
      {isOpen && (
        <div
          onClick={onToggle}
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-xs xl:hidden"
        />
      )}

      {/* Floating Right Edge Trigger Tab when Slide-bar is collapsed */}
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          title="Mở thanh xem trước màn hình khách (Slide-bar bên phải)"
          className="fixed right-0 top-24 z-40 flex items-center gap-2 rounded-l-2xl border border-r-0 border-emerald-500/40 bg-slate-950 px-3.5 py-3 text-xs font-black text-white shadow-2xl transition-all hover:bg-emerald-600 hover:pr-5"
        >
          <ChevronLeft className="h-4 w-4 text-emerald-400" />
          <Smartphone className="h-4 w-4 text-emerald-400" />
          <span className="hidden sm:inline">Xem trước màn hình khách</span>
          <span className="sm:hidden">Preview</span>
        </button>
      )}

      {/* Docked Right Sidebar (Slide-bar bên phải) */}
      <aside
        aria-label="Xem trước màn hình khách"
        className={`fixed inset-y-0 right-0 z-40 w-[355px] sm:w-[385px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Left-edge Handle Tab to Collapse Slide-bar */}
        {isOpen && (
          <button
            type="button"
            onClick={onToggle}
            title="Thu gọn thanh xem trước"
            className="hidden sm:flex absolute -left-9 top-24 h-16 w-9 items-center justify-center rounded-l-2xl border border-r-0 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 shadow-lg hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        {/* Right Sidebar Header */}
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Eye className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-xs font-black text-slate-900 dark:text-white">
                  Live Preview • Màn hình khách
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              </div>
              <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={`/s/${shop.slug}/menu?src=table`}
              target="_blank"
              rel="noopener noreferrer"
              title="Mở trang thực tế trên tab mới"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:text-emerald-600 transition"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Mở thật</span>
            </a>
            <button
              type="button"
              onClick={onToggle}
              title="Thu gọn Slide-bar"
              className="inline-flex items-center gap-1 rounded-xl bg-slate-200/80 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span className=" sm:inline">Ẩn</span>
            </button>
          </div>
        </div>

        {/* Scrollable Phone Mockup + Extra Controls */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar flex flex-col items-center">
          <div className="w-full">
            <StorefrontPhonePreview
              shop={shop}
              items={items}
              onOpenPopupPreview={onOpenPopupPreview}
            />
          </div>

          {children && <div className="w-full max-w-[330px] space-y-2.5">{children}</div>}
        </div>
      </aside>
    </>
  );
}
