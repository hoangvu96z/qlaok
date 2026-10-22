'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TableFloorStatus } from '@/types/qlaok';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export type ShopTableFloorStatus = TableFloorStatus;

export interface ShopTableFloorPlanCanvasItem {
  id: string;
  name: string;
  table_code: string;
  section?: string | null;
  capacity?: number | null;
  is_active: boolean;
  layout_x?: number | null;
  layout_y?: number | null;
  floor_status: TableFloorStatus;
  open_order_count?: number | null;
  unpaid_amount?: number | null;
  [key: string]: unknown;
}

export interface ShopTableFloorPlanCanvasProps {
  tables: ShopTableFloorPlanCanvasItem[];
  selectedTableId?: string | null;
  onSelectTable?: (table: ShopTableFloorPlanCanvasItem) => void;
  onMoveTable?: (
    table: ShopTableFloorPlanCanvasItem,
    position: { x: number; y: number }
  ) => void;
  locale?: 'vi' | 'en';
  className?: string;
  surfaceDimensions?: { width: number; height: number };
}

export interface ResolvedTableCoordinates {
  x: number; // percentage in [0, 100]
  y: number; // percentage in [0, 100]
  isFallback: boolean;
}

export interface CanvasBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const CANVAS_BOUNDS: CanvasBounds = {
  minX: 7,
  maxX: 93,
  minY: 9,
  maxY: 91,
} as const;

export const CANVAS_SAFE_MARGINS = {
  horizontalPx: 80,
  verticalPx: 64,
} as const;

export function getSafeCanvasBounds(
  surfaceRect?: { width: number; height: number } | null
): CanvasBounds {
  if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) {
    return CANVAS_BOUNDS;
  }

  const { width, height } = surfaceRect;

  // On wide desktop canvases (such as 1200x680 or 1248x680 in desktop setups),
  // the original 7/93 and 9/91 limits remain effective without clipping desktop markers.
  if (width >= 1200 && height >= 680) {
    return CANVAS_BOUNDS;
  }

  // Safe horizontal margin: keep x at least 80px from horizontal edges on narrow canvas
  const minXPx = Math.max(CANVAS_SAFE_MARGINS.horizontalPx, (CANVAS_BOUNDS.minX / 100) * width);
  const minX = Math.ceil(((minXPx / width) * 100) * 10) / 10;
  const maxX = Math.floor((100 - (minXPx / width) * 100) * 10) / 10;

  // Safe vertical margin: keep y at least 64px from vertical edges on narrow canvas
  const minYPx = Math.max(CANVAS_SAFE_MARGINS.verticalPx, (CANVAS_BOUNDS.minY / 100) * height);
  const minY = Math.ceil(((minYPx / height) * 100) * 10) / 10;
  const maxY = Math.floor((100 - (minYPx / height) * 100) * 10) / 10;

  return {
    minX: Math.max(CANVAS_BOUNDS.minX, minX),
    maxX: Math.min(CANVAS_BOUNDS.maxX, maxX),
    minY: Math.max(CANVAS_BOUNDS.minY, minY),
    maxY: Math.min(CANVAS_BOUNDS.maxY, maxY),
  };
}

export function clampTableCoordinateX(
  x: number,
  surfaceRect?: { width: number; height: number } | null
): number {
  const bounds = getSafeCanvasBounds(surfaceRect);
  return (
    Math.round(Math.max(bounds.minX, Math.min(bounds.maxX, x)) * 10) / 10
  );
}

export function clampTableCoordinateY(
  y: number,
  surfaceRect?: { width: number; height: number } | null
): number {
  const bounds = getSafeCanvasBounds(surfaceRect);
  return (
    Math.round(Math.max(bounds.minY, Math.min(bounds.maxY, y)) * 10) / 10
  );
}

export function clampTableCoordinates(
  x: number,
  y: number,
  surfaceRect?: { width: number; height: number } | null
): { x: number; y: number } {
  return {
    x: clampTableCoordinateX(x, surfaceRect),
    y: clampTableCoordinateY(y, surfaceRect),
  };
}

export function convertPointToCanvasCoordinates(
  point: { clientX: number; clientY: number },
  surfaceRect: { left: number; top: number; width: number; height: number },
  startPos?: { clientX: number; clientY: number; startX: number; startY: number }
): { x: number; y: number } {
  if (surfaceRect.width <= 0 || surfaceRect.height <= 0) {
    return { x: 50, y: 50 };
  }
  if (startPos) {
    const deltaX = point.clientX - startPos.clientX;
    const deltaY = point.clientY - startPos.clientY;
    const deltaPercentX = (deltaX / surfaceRect.width) * 100;
    const deltaPercentY = (deltaY / surfaceRect.height) * 100;
    return clampTableCoordinates(
      startPos.startX + deltaPercentX,
      startPos.startY + deltaPercentY,
      surfaceRect
    );
  }
  const rawX = ((point.clientX - surfaceRect.left) / surfaceRect.width) * 100;
  const rawY = ((point.clientY - surfaceRect.top) / surfaceRect.height) * 100;
  return clampTableCoordinates(rawX, rawY, surfaceRect);
}

export function isValidCoordinate(val: unknown): val is number {
  return (
    typeof val === 'number' &&
    Number.isFinite(val) &&
    val >= 0 &&
    val <= 100
  );
}

const COLLISION_THRESHOLD_X = 12;
const COLLISION_THRESHOLD_Y = 10;

function isColliding(
  x: number,
  y: number,
  occupied: readonly { x: number; y: number }[]
): boolean {
  for (const pos of occupied) {
    if (
      Math.abs(pos.x - x) < COLLISION_THRESHOLD_X &&
      Math.abs(pos.y - y) < COLLISION_THRESHOLD_Y
    ) {
      return true;
    }
  }
  return false;
}

function buildCandidateGrid(): { x: number; y: number }[] {
  const candidates: { x: number; y: number }[] = [];
  const seen = new Set<string>();

  const addPoint = (x: number, y: number) => {
    const rx = clampTableCoordinateX(x);
    const ry = clampTableCoordinateY(y);
    const key = `${rx},${ry}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ x: rx, y: ry });
    }
  };

  // Center slot first
  addPoint(50, 50);

  // Progressive grids covering canvas area [14..86] x [18..82]
  const gridConfigs = [
    { cols: 3, rows: 3 },
    { cols: 5, rows: 5 },
    { cols: 7, rows: 6 },
    { cols: 9, rows: 8 },
    { cols: 11, rows: 10 },
  ];

  for (const { cols, rows } of gridConfigs) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = cols === 1 ? 50 : 14 + (c / (cols - 1)) * 72;
        const y = rows === 1 ? 50 : 18 + (r / Math.max(1, rows - 1)) * 64;
        addPoint(x, y);
      }
    }
  }

  return candidates;
}

const FALLBACK_CANDIDATE_POOL = buildCandidateGrid();

/**
 * Computes percentage positions for all tables on the floor plan canvas.
 * - Tables with valid `layout_x` & `layout_y` (numbers in 0..100) are clamped safely within canvas padding (x: 7..93, y: 9..91).
 *   Owner-set positions are strictly preserved and never silently moved.
 * - Tables with null, partial, or invalid coordinates are assigned deterministic fallback slots
 *   while avoiding every already-resolved explicit position and every earlier fallback position.
 */
export function resolveTableCoordinates<
  T extends { id: string; layout_x?: number | null; layout_y?: number | null }
>(tables: readonly T[]): Map<string, ResolvedTableCoordinates> {
  const result = new Map<string, ResolvedTableCoordinates>();
  const unpositioned: T[] = [];
  const occupied: { x: number; y: number }[] = [];

  // 1. Resolve explicit positions first and preserve them strictly (never silently moved)
  for (const table of tables) {
    if (isValidCoordinate(table.layout_x) && isValidCoordinate(table.layout_y)) {
      const x = clampTableCoordinateX(table.layout_x);
      const y = clampTableCoordinateY(table.layout_y);
      result.set(table.id, {
        x,
        y,
        isFallback: false,
      });
      occupied.push({ x, y });
    } else {
      unpositioned.push(table);
    }
  }

  // 2. Deterministically assign non-colliding fallback slots to unpositioned tables
  const count = unpositioned.length;
  if (count > 0) {
    const cols =
      count <= 2 ? count : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;
    const totalRows = Math.ceil(count / cols);

    unpositioned.forEach((table, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const x = cols === 1 ? 50 : 14 + (col / (cols - 1)) * 72;
      const y =
        totalRows === 1 ? 50 : 18 + (row / Math.max(1, totalRows - 1)) * 64;

      const primarySlot = {
        x: Math.round(Math.max(7, Math.min(93, x)) * 10) / 10,
        y: Math.round(Math.max(9, Math.min(91, y)) * 10) / 10,
      };

      let chosenSlot: { x: number; y: number };

      if (!isColliding(primarySlot.x, primarySlot.y, occupied)) {
        chosenSlot = primarySlot;
      } else {
        // Find nearest candidate slot that avoids every explicit & earlier fallback position
        const sorted = [...FALLBACK_CANDIDATE_POOL].sort((a, b) => {
          const distA = Math.hypot(a.x - primarySlot.x, a.y - primarySlot.y);
          const distB = Math.hypot(b.x - primarySlot.x, b.y - primarySlot.y);
          if (Math.abs(distA - distB) > 0.001) {
            return distA - distB;
          }
          if (a.y !== b.y) {
            return a.y - b.y;
          }
          return a.x - b.x;
        });

        const available = sorted.find(
          (cand) => !isColliding(cand.x, cand.y, occupied)
        );

        if (available) {
          chosenSlot = available;
        } else {
          chosenSlot = {
            x: Math.round(Math.max(7, Math.min(93, primarySlot.x + (index % 10) * 2)) * 10) / 10,
            y: Math.round(Math.max(9, Math.min(91, primarySlot.y + Math.floor(index / 10) * 2)) * 10) / 10,
          };
        }
      }

      occupied.push(chosenSlot);
      result.set(table.id, {
        x: chosenSlot.x,
        y: chosenSlot.y,
        isFallback: true,
      });
    });
  }

  return result;
}

interface StatusVisual {
  label: (tx: (vi: string, en: string) => string) => string;
  badgeClass: string;
  markerBorderClass: string;
  dotClass: string;
  symbol: string;
}

const STATUS_CONFIG: Record<TableFloorStatus, StatusVisual> = {
  free: {
    label: (tx) => tx('Trống', 'Available'),
    badgeClass:
      'bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-200 dark:border-emerald-700',
    markerBorderClass:
      'border-emerald-500/80 hover:border-emerald-600 dark:border-emerald-500/80',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
    symbol: '●',
  },
  occupied: {
    label: (tx) => tx('Đang phục vụ', 'Occupied'),
    badgeClass:
      'bg-sky-100 text-sky-950 border-sky-300 dark:bg-sky-950/80 dark:text-sky-200 dark:border-sky-700',
    markerBorderClass:
      'border-sky-500/80 hover:border-sky-600 dark:border-sky-500/80',
    dotClass: 'bg-sky-500 dark:bg-sky-400',
    symbol: '●',
  },
  waiting_payment: {
    label: (tx) => tx('Chờ thanh toán', 'Waiting payment'),
    badgeClass:
      'bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-700',
    markerBorderClass:
      'border-amber-500/80 hover:border-amber-600 dark:border-amber-500/80',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    symbol: '●',
  },
  inactive: {
    label: (tx) => tx('Tạm ngưng', 'Inactive'),
    badgeClass:
      'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    markerBorderClass:
      'border-slate-300 hover:border-slate-400 dark:border-slate-700',
    dotClass: 'bg-slate-400 dark:bg-slate-500',
    symbol: '○',
  },
};

export function isValidFloorStatus(status: unknown): status is TableFloorStatus {
  return (
    typeof status === 'string' &&
    Object.prototype.hasOwnProperty.call(STATUS_CONFIG, status)
  );
}

export function resolveFloorStatus(status: unknown): TableFloorStatus {
  return isValidFloorStatus(status) ? status : 'free';
}

function parseFiniteNumber(val: unknown, fallback: number): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
  }
  return fallback;
}

export function resolveTableCapacity(val: unknown, fallback = 4): number {
  const num = parseFiniteNumber(val, fallback);
  return Math.max(1, Math.round(num));
}

export function resolveTableCount(val: unknown, fallback = 0): number {
  const num = parseFiniteNumber(val, fallback);
  return Math.max(0, Math.round(num));
}

export function resolveTableAmount(val: unknown, fallback = 0): number {
  const num = parseFiniteNumber(val, fallback);
  return Math.max(0, Math.round(num));
}

function formatVnd(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return `${safe.toLocaleString('vi-VN')}đ`;
}

export interface PostDragClickGuardState {
  tableId: string;
}

export interface PostDragClickGuard {
  arm: (tableId: string) => void;
  clear: () => void;
  shouldSuppressClick: (tableId: string, event?: { detail?: number }) => boolean;
  isArmed: (tableId?: string) => boolean;
}

export function createPostDragClickGuard(
  scheduleTimeout: (cb: () => void, ms?: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancelTimeout: (id: ReturnType<typeof setTimeout>) => void = clearTimeout
): PostDragClickGuard {
  let pendingState: PostDragClickGuardState | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timerId !== null) {
      cancelTimeout(timerId);
      timerId = null;
    }
    pendingState = null;
  };

  const arm = (tableId: string) => {
    clear();
    pendingState = { tableId };
    timerId = scheduleTimeout(() => {
      pendingState = null;
      timerId = null;
    }, 0);
  };

  const shouldSuppressClick = (
    tableId: string,
    event?: { detail?: number }
  ): boolean => {
    // Keyboard activation (detail === 0) is never suppressed.
    if (event && event.detail === 0) {
      return false;
    }

    if (pendingState && pendingState.tableId === tableId) {
      clear();
      return true;
    }

    return false;
  };

  const isArmed = (tableId?: string): boolean => {
    if (!pendingState) return false;
    return tableId ? pendingState.tableId === tableId : true;
  };

  return {
    arm,
    clear,
    shouldSuppressClick,
    isArmed,
  };
}

/**
 * Presentational table floor-plan canvas component.
 * - Displays a responsive surface with table markers positioned via percentage coordinates.
 * - Employs a deterministic fallback layout when table coordinates are null/unset.
 * - Distinguishes free / occupied / waiting_payment / inactive with accessible colors, symbols, and text.
 * - Includes a compact status legend with live counts.
 * - Performs zero network calls, data fetching, dragging, or external storage mutations.
 */
export function ShopTableFloorPlanCanvas({
  tables,
  selectedTableId = null,
  onSelectTable,
  onMoveTable,
  locale: propLocale,
  className = '',
  surfaceDimensions: propSurfaceDimensions,
}: ShopTableFloorPlanCanvasProps) {
  // Existing surrounding APIs rely on context; support explicit prop overrides for standalone/test harnesses.
  const appI18n = useAppI18n();
  const effectiveLocale = propLocale || appI18n?.locale || 'vi';
  const isEn = effectiveLocale === 'en';

  const tx = useMemo(
    () => (viText: string, enText: string) => (isEn ? enText : viText),
    [isEn]
  );

  const patternId = `qlaok-floor-plan-grid-${useId()}`;

  const coordinatesMap = useMemo(
    () => resolveTableCoordinates(tables),
    [tables]
  );

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceRect, setSurfaceRect] = useState<{ width: number; height: number } | null>(
    propSurfaceDimensions || null
  );

  useEffect(() => {
    if (propSurfaceDimensions) {
      setSurfaceRect(propSurfaceDimensions);
      return;
    }

    const el = surfaceRef.current;
    if (!el) return;

    const updateSurfaceRect = () => {
      const rect = el.getBoundingClientRect();
      setSurfaceRect((prev) => {
        if (
          prev &&
          Math.abs(prev.width - rect.width) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
        ) {
          return prev;
        }
        return { width: rect.width, height: rect.height };
      });
    };

    updateSurfaceRect();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateSurfaceRect();
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
      };
    } else {
      window.addEventListener('resize', updateSurfaceRect);
      return () => {
        window.removeEventListener('resize', updateSurfaceRect);
      };
    }
  }, [propSurfaceDimensions]);

  const [dragPreview, setDragPreview] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const dragStateRef = useRef<{
    table: ShopTableFloorPlanCanvasItem;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    movedPastThreshold: boolean;
  } | null>(null);

  const dragClickGuardRef = useRef<PostDragClickGuard | null>(null);
  if (!dragClickGuardRef.current) {
    dragClickGuardRef.current = createPostDragClickGuard();
  }
  const dragClickGuard = dragClickGuardRef.current;

  useEffect(() => {
    return () => {
      dragClickGuard.clear();
    };
  }, [dragClickGuard]);

  const isMovable = Boolean(onMoveTable);
  const isSelectable = Boolean(onSelectTable);
  const isInteractive = isSelectable || isMovable;

  const handlePointerDown = (
    table: ShopTableFloorPlanCanvasItem,
    event: React.PointerEvent<HTMLElement>
  ) => {
    if (!onMoveTable) return;
    if (event.button !== 0) return;

    dragClickGuard.clear();

    const surface = surfaceRef.current;
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const rawCoords = coordinatesMap.get(table.id) || { x: 50, y: 50, isFallback: true };
    const renderedPos = clampTableCoordinates(rawCoords.x, rawCoords.y, rect);
    const currentPos =
      dragPreview?.id === table.id
        ? { x: dragPreview.x, y: dragPreview.y }
        : renderedPos;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignored in environments without pointer capture support
    }

    dragStateRef.current = {
      table,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: currentPos.x,
      startY: currentPos.y,
      currentX: currentPos.x,
      currentY: currentPos.y,
      movedPastThreshold: false,
    };
  };

  const handlePointerMove = (
    table: ShopTableFloorPlanCanvasItem,
    event: React.PointerEvent<HTMLElement>
  ) => {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.table.id !== table.id) return;
    if (activeDrag.pointerId !== event.pointerId) return;

    const dx = event.clientX - activeDrag.startClientX;
    const dy = event.clientY - activeDrag.startClientY;
    const distance = Math.hypot(dx, dy);

    if (distance > 4) {
      activeDrag.movedPastThreshold = true;
    }

    const surface = surfaceRef.current;
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const nextCoords = convertPointToCanvasCoordinates(
      { clientX: event.clientX, clientY: event.clientY },
      rect,
      {
        clientX: activeDrag.startClientX,
        clientY: activeDrag.startClientY,
        startX: activeDrag.startX,
        startY: activeDrag.startY,
      }
    );

    activeDrag.currentX = nextCoords.x;
    activeDrag.currentY = nextCoords.y;

    setDragPreview({
      id: table.id,
      x: nextCoords.x,
      y: nextCoords.y,
    });
  };

  const handlePointerUp = (
    table: ShopTableFloorPlanCanvasItem,
    event: React.PointerEvent<HTMLElement>
  ) => {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.table.id !== table.id) return;
    if (activeDrag.pointerId !== event.pointerId) return;

    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // Ignored
    }

    const dx = event.clientX - activeDrag.startClientX;
    const dy = event.clientY - activeDrag.startClientY;
    const distance = Math.hypot(dx, dy);
    const movedPast4px = distance > 4 || activeDrag.movedPastThreshold;

    const surface = surfaceRef.current;
    let isInside = false;
    if (surface) {
      const rect = surface.getBoundingClientRect();
      isInside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
    }

    setDragPreview(null);
    dragStateRef.current = null;

    if (movedPast4px) {
      dragClickGuard.arm(table.id);
      if (isInside && onMoveTable) {
        onMoveTable(table, {
          x: activeDrag.currentX,
          y: activeDrag.currentY,
        });
      }
    }
  };

  const handlePointerCancel = (
    table: ShopTableFloorPlanCanvasItem,
    event: React.PointerEvent<HTMLElement>
  ) => {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.table.id !== table.id) return;
    if (activeDrag.pointerId !== event.pointerId) return;

    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // Ignored
    }

    dragClickGuard.clear();
    setDragPreview(null);
    dragStateRef.current = null;
  };

  const handleLostPointerCapture = (
    table: ShopTableFloorPlanCanvasItem
  ) => {
    if (dragStateRef.current?.table.id === table.id) {
      dragClickGuard.clear();
      setDragPreview(null);
      dragStateRef.current = null;
    }
  };

  const handleClick = (
    table: ShopTableFloorPlanCanvasItem,
    event?: React.MouseEvent<HTMLElement>
  ) => {
    if (dragClickGuard.shouldSuppressClick(table.id, event)) {
      return;
    }
    onSelectTable?.(table);
  };

  const handleKeyDown = (
    table: ShopTableFloorPlanCanvasItem,
    event: React.KeyboardEvent<HTMLElement>
  ) => {
    if (!onMoveTable) return;

    const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
    if (!ARROW_KEYS.includes(event.key as (typeof ARROW_KEYS)[number])) {
      return;
    }

    event.preventDefault();

    const surface = surfaceRef.current;
    const rect = surface ? surface.getBoundingClientRect() : propSurfaceDimensions || surfaceRect;

    const rawCoords = coordinatesMap.get(table.id) || { x: 50, y: 50, isFallback: true };
    const renderedPos = clampTableCoordinates(rawCoords.x, rawCoords.y, rect);
    const currentPos =
      dragPreview?.id === table.id
        ? { x: dragPreview.x, y: dragPreview.y }
        : renderedPos;

    let nextX = currentPos.x;
    let nextY = currentPos.y;

    if (event.key === 'ArrowLeft') nextX -= 2;
    if (event.key === 'ArrowRight') nextX += 2;
    if (event.key === 'ArrowUp') nextY -= 2;
    if (event.key === 'ArrowDown') nextY += 2;

    const clamped = clampTableCoordinates(nextX, nextY, rect);
    onMoveTable(table, clamped);
  };

  const statusCounts = useMemo(() => {
    const counts: Record<TableFloorStatus, number> = {
      free: 0,
      occupied: 0,
      waiting_payment: 0,
      inactive: 0,
    };
    for (const table of tables) {
      const resolved = resolveFloorStatus(table.floor_status);
      counts[resolved]++;
    }
    return counts;
  }, [tables]);

  return (
    <div
      data-testid="shop-table-floor-plan-wrapper"
      className={`space-y-3 ${className}`.trim()}
    >
      {/* Compact Status Legend */}
      <div
        role="region"
        aria-label={tx('Chú thích trạng thái bàn', 'Table status legend')}
        data-testid="floor-plan-legend"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {tx('Trạng thái bàn', 'Table Status')}
          </span>
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            ({tables.length} {tx('bàn', tables.length === 1 ? 'table' : 'tables')})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {(['free', 'occupied', 'waiting_payment', 'inactive'] as const).map(
            (status) => {
              const cfg = STATUS_CONFIG[status];
              const count = statusCounts[status] || 0;
              return (
                <span
                  key={status}
                  data-testid={`floor-plan-legend-${status}`}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${cfg.badgeClass}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${cfg.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{cfg.label(tx)}</span>
                  <span className="opacity-80">({count})</span>
                </span>
              );
            }
          )}
        </div>
      </div>

      {/* Responsive Floor Plan Canvas Surface */}
      <div
        ref={surfaceRef}
        data-testid="shop-table-floor-plan-surface"
        className="relative w-full aspect-[16/10] min-h-[420px] max-h-[680px] rounded-2xl border-2 border-slate-200 bg-slate-50/70 p-4 shadow-inner overflow-hidden select-none dark:border-slate-800 dark:bg-slate-950/70"
      >
        {/* Subtle Architectural Grid Pattern */}
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none opacity-30 dark:opacity-15"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id={patternId}
              width="36"
              height="36"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 36 0 L 0 0 0 36"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.75"
                className="text-slate-400 dark:text-slate-600"
              />
              <circle
                cx="36"
                cy="36"
                r="1.25"
                className="fill-slate-400 dark:fill-slate-600"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>

        {/* Empty State */}
        {tables.length === 0 && (
          <div
            data-testid="floor-plan-empty"
            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-400 dark:text-slate-500"
          >
            <svg
              className="h-10 w-10 mb-2 stroke-1 text-slate-400 dark:text-slate-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
              <path d="M3 9h18M9 21V9" strokeWidth="1.5" />
            </svg>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
              {tx('Chưa có bàn nào trong sơ đồ', 'No tables in floor plan')}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {tx(
                'Danh sách bàn của quán sẽ xuất hiện trực quan trên bề mặt sơ đồ này.',
                'The shop tables will appear visually on this floor plan surface.'
              )}
            </p>
          </div>
        )}

        {/* Positioned Table Markers */}
        {tables.map((table) => {
          const coords = coordinatesMap.get(table.id) || {
            x: 50,
            y: 50,
            isFallback: true,
          };
          const isDragging = dragPreview?.id === table.id;
          const currentBase = isDragging
            ? { x: dragPreview.x, y: dragPreview.y, isFallback: coords.isFallback }
            : coords;
          const clamped = clampTableCoordinates(
            currentBase.x,
            currentBase.y,
            propSurfaceDimensions || surfaceRect
          );
          const currentCoords = {
            x: clamped.x,
            y: clamped.y,
            isFallback: coords.isFallback,
          };
          const floorStatus = resolveFloorStatus(table.floor_status);
          const cfg = STATUS_CONFIG[floorStatus];
          const isSelected = selectedTableId === table.id;
          const openOrders = resolveTableCount(table.open_order_count, 0);
          const unpaid = resolveTableAmount(table.unpaid_amount, 0);
          const capacity = resolveTableCapacity(table.capacity, 4);
          const sectionName =
            typeof table.section === 'string' ? table.section.trim() : '';
          const displayName =
            typeof table.name === 'string' ? table.name.trim() : '';
          const rawCode =
            typeof table.table_code === 'string' ? table.table_code.trim() : '';
          const fallbackId = String(table.id ?? '').trim();
          const displayCode = rawCode || displayName || fallbackId;

          const ariaLabel = [
            displayCode,
            displayName && displayName !== displayCode ? `(${displayName})` : null,
            sectionName ? `${tx('Khu vực', 'Section')}: ${sectionName}` : null,
            `${tx('Sức chứa', 'Capacity')}: ${capacity}`,
            `${tx('Trạng thái', 'Status')}: ${cfg.label(tx)}`,
            openOrders > 0
              ? `${openOrders} ${tx(
                  'đơn đang mở',
                  openOrders === 1 ? 'open order' : 'open orders'
                )}`
              : null,
            unpaid > 0 ? `${tx('Chưa thu', 'Unpaid')}: ${formatVnd(unpaid)}` : null,
            isMovable
              ? tx(
                  'Kéo hoặc dùng phím mũi tên để di chuyển vị trí',
                  'Drag or use arrow keys to move position'
                )
              : null,
          ]
            .filter(Boolean)
            .join(' · ');

          const dragCursorClass = isMovable
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : isSelectable
              ? 'cursor-pointer'
              : '';

          const markerClassName = `absolute z-10 w-28 sm:w-36 rounded-2xl border-2 bg-white/95 p-2 sm:p-2.5 text-left shadow-xs backdrop-blur-xs ${
            isDragging
              ? 'transition-none z-30 shadow-lg scale-105'
              : 'transition-all duration-150'
          } ${
            isInteractive
              ? `${dragCursorClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2`
              : ''
          } dark:bg-slate-900/95 ${cfg.markerBorderClass} ${
            isSelected
              ? 'ring-2 ring-emerald-500 ring-offset-2 scale-105 shadow-md z-20'
              : isInteractive && !isDragging
                ? 'hover:scale-[1.03] hover:shadow-md'
                : ''
          } ${!table.is_active ? 'opacity-70' : ''}`;

          const markerStyle: React.CSSProperties = {
            left: `${currentCoords.x}%`,
            top: `${currentCoords.y}%`,
            transform: 'translate(-50%, -50%)',
            ...(isMovable
              ? {
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }
              : {}),
          };

          const markerContent = (
            <>
              {/* Header: Table Code & Capacity Badge */}
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-xs sm:text-sm font-black text-slate-900 dark:text-white">
                  {displayCode}
                </span>
                <span
                  title={`${capacity} ${tx('chỗ ngồi', capacity === 1 ? 'seat' : 'seats')}`}
                  className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  <span aria-hidden="true">👥</span>
                  <span>{capacity}</span>
                </span>
              </div>

              {/* Subtitle: Table Name (if distinct from Code) */}
              {displayName && displayName !== displayCode && (
                <span className="block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {displayName}
                </span>
              )}

              {/* Section Tag */}
              {sectionName && (
                <div className="mt-0.5">
                  <span className="inline-block truncate max-w-full rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {sectionName}
                  </span>
                </div>
              )}

              {/* Accessible Status Pill */}
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold ${cfg.badgeClass}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{cfg.label(tx)}</span>
                </span>

                {coords.isFallback && (
                  <span
                    title={tx(
                      'Tọa độ tự động sắp xếp',
                      'Deterministic auto-layout fallback'
                    )}
                    className="text-[9px] font-semibold text-slate-400 dark:text-slate-500"
                  >
                    auto
                  </span>
                )}
              </div>

              {/* Operational Metrics: Orders & Unpaid Amount */}
              {(openOrders > 0 || unpaid > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                  {openOrders > 0 && (
                    <span
                      title={`${openOrders} ${tx(
                        'đơn hàng đang xử lý',
                        openOrders === 1 ? 'order in progress' : 'orders in progress'
                      )}`}
                      className="rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 font-bold text-sky-800 dark:bg-sky-950/70 dark:border-sky-800 dark:text-sky-300"
                    >
                      {openOrders} {tx('đơn', openOrders === 1 ? 'order' : 'orders')}
                    </span>
                  )}
                  {unpaid > 0 && (
                    <span
                      title={`${tx('Chưa thanh toán', 'Unpaid')}: ${formatVnd(unpaid)}`}
                      className="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 font-black text-rose-800 dark:bg-rose-950/70 dark:border-rose-800 dark:text-rose-300"
                    >
                      {formatVnd(unpaid)}
                    </span>
                  )}
                </div>
              )}
            </>
          );

          if (isInteractive) {
            return (
              <button
                key={table.id}
                type="button"
                aria-label={ariaLabel}
                aria-pressed={isSelectable ? isSelected : undefined}
                aria-description={
                  isMovable
                    ? tx(
                        'Dùng phím mũi tên hoặc kéo để di chuyển vị trí bàn',
                        'Use arrow keys or drag to move table position'
                      )
                    : undefined
                }
                data-testid={`floor-plan-marker-${table.id}`}
                data-table-code={rawCode || displayCode}
                data-table-id={table.id}
                data-floor-status={floorStatus}
                data-selected={isSelected ? 'true' : 'false'}
                data-fallback-position={coords.isFallback ? 'true' : 'false'}
                data-draggable={isMovable ? 'true' : 'false'}
                data-dragging={isDragging ? 'true' : undefined}
                onClick={(e) => handleClick(table, e)}
                onKeyDown={(e) => handleKeyDown(table, e)}
                onPointerDown={(e) => handlePointerDown(table, e)}
                onPointerMove={(e) => handlePointerMove(table, e)}
                onPointerUp={(e) => handlePointerUp(table, e)}
                onPointerCancel={(e) => handlePointerCancel(table, e)}
                onLostPointerCapture={() => handleLostPointerCapture(table)}
                style={markerStyle}
                className={markerClassName}
              >
                {markerContent}
              </button>
            );
          }

          return (
            <div
              key={table.id}
              aria-label={ariaLabel}
              data-testid={`floor-plan-marker-${table.id}`}
              data-table-code={rawCode || displayCode}
              data-table-id={table.id}
              data-floor-status={floorStatus}
              data-selected={isSelected ? 'true' : 'false'}
              data-fallback-position={coords.isFallback ? 'true' : 'false'}
              data-draggable="false"
              style={markerStyle}
              className={markerClassName}
            >
              {markerContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}
