'use client';

import React, { useEffect, useMemo, useState } from 'react';
import DataTable, {
  SortOrder,
  type ConditionalStyles,
  type DataTableHandle,
  type Localization,
  type PaginationOptions,
  type TableColumn,
  type TableProps,
  type TableStyles,
  type Theme,
} from 'react-data-table-component';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import {
  getInitialTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from '@/components/ui/ThemeToggle';

export {
  SortOrder,
  type ConditionalStyles,
  type DataTableHandle,
  type Localization,
  type PaginationOptions,
  type TableColumn,
  type TableProps,
  type TableStyles,
  type Theme,
};

export interface AppDataTableProps<T> extends TableProps<T> {
  forceDark?: boolean;
}

function readDomThemeMode(): ThemeMode {
  if (typeof document === 'undefined') {
    return 'light';
  }
  const root = document.documentElement;
  const dataTheme = root.getAttribute('data-theme');
  if (dataTheme === 'dark' || dataTheme === 'light') {
    return dataTheme;
  }
  if (root.classList.contains('dark')) {
    return 'dark';
  }
  if (root.classList.contains('light')) {
    return 'light';
  }
  return getInitialTheme();
}

const QLAOK_TABLE_THEME: Partial<Theme> = {
  primary: '#059669',
  text: {
    primary: '#0f172a',
    secondary: '#475569',
    disabled: '#94a3b8',
  },
  background: {
    default: '#ffffff',
    header: '#f8fafc',
    footer: '#f8fafc',
  },
  context: {
    background: '#ecfdf5',
    text: '#065f46',
  },
  divider: {
    default: '#e2e8f0',
  },
  button: {
    default: '#475569',
    focus: 'rgba(16, 185, 129, 0.18)',
    hover: 'rgba(15, 23, 42, 0.06)',
    disabled: '#cbd5e1',
  },
  selected: {
    default: '#ecfdf5',
    text: '#0f172a',
  },
  highlightOnHover: {
    default: '#f8fafc',
    text: '#0f172a',
  },
  striped: {
    default: '#f8fafc',
    text: '#0f172a',
  },
  spacing: {
    rowHeight: '46px',
    headerHeight: '42px',
    cellPaddingX: '14px',
    iconSize: '16px',
  },
  typography: {
    fontSize: '13px',
    fontSizeHeader: '11px',
  },
  shape: {
    borderRadius: '12px',
  },
  checkbox: {
    size: '16px',
    borderRadius: '4px',
  },
  headerSeparator: false,
  columnSeparator: false,
  darkMode: {
    primary: '#10b981',
    text: {
      primary: '#f1f5f9',
      secondary: '#94a3b8',
      disabled: '#475569',
    },
    background: {
      default: '#0f172a',
      header: '#090d16',
      footer: '#090d16',
    },
    context: {
      background: 'rgba(16, 185, 129, 0.15)',
      text: '#6ee7b7',
    },
    divider: {
      default: '#1e293b',
    },
    button: {
      default: '#94a3b8',
      focus: 'rgba(16, 185, 129, 0.22)',
      hover: 'rgba(255, 255, 255, 0.06)',
      disabled: '#334155',
    },
    selected: {
      default: 'rgba(16, 185, 129, 0.14)',
      text: '#f8fafc',
    },
    highlightOnHover: {
      default: 'rgba(30, 41, 59, 0.65)',
      text: '#f8fafc',
    },
    striped: {
      default: 'rgba(15, 23, 42, 0.6)',
      text: '#f1f5f9',
    },
  },
};

function mergeTableStyles(
  base: TableStyles,
  override?: TableStyles
): TableStyles {
  if (!override) return base;
  return {
    table: {
      style: { ...base.table?.style, ...override.table?.style },
    },
    tableWrapper: {
      style: { ...base.tableWrapper?.style, ...override.tableWrapper?.style },
    },
    responsiveWrapper: {
      style: {
        ...base.responsiveWrapper?.style,
        ...override.responsiveWrapper?.style,
      },
    },
    header: {
      ...base.header,
      ...override.header,
      style: { ...base.header?.style, ...override.header?.style },
    },
    subHeader: {
      style: { ...base.subHeader?.style, ...override.subHeader?.style },
    },
    head: {
      style: { ...base.head?.style, ...override.head?.style },
    },
    headRow: {
      style: { ...base.headRow?.style, ...override.headRow?.style },
      denseStyle: {
        ...base.headRow?.denseStyle,
        ...override.headRow?.denseStyle,
      },
    },
    headCells: {
      style: { ...base.headCells?.style, ...override.headCells?.style },
      draggingStyle: {
        ...base.headCells?.draggingStyle,
        ...override.headCells?.draggingStyle,
      },
    },
    cells: {
      style: { ...base.cells?.style, ...override.cells?.style },
      draggingStyle: {
        ...base.cells?.draggingStyle,
        ...override.cells?.draggingStyle,
      },
    },
    rows: {
      style: { ...base.rows?.style, ...override.rows?.style },
      selectedHighlightStyle: {
        ...base.rows?.selectedHighlightStyle,
        ...override.rows?.selectedHighlightStyle,
      },
      denseStyle: {
        ...base.rows?.denseStyle,
        ...override.rows?.denseStyle,
      },
      highlightOnHoverStyle: {
        ...base.rows?.highlightOnHoverStyle,
        ...override.rows?.highlightOnHoverStyle,
      },
      stripedStyle: {
        ...base.rows?.stripedStyle,
        ...override.rows?.stripedStyle,
      },
    },
    expanderRow: override.expanderRow ?? base.expanderRow,
    expanderCell: override.expanderCell ?? base.expanderCell,
    expanderButton: override.expanderButton ?? base.expanderButton,
    pagination: {
      style: { ...base.pagination?.style, ...override.pagination?.style },
      pageButtonsStyle: {
        ...base.pagination?.pageButtonsStyle,
        ...override.pagination?.pageButtonsStyle,
      },
    },
    footer: {
      style: { ...base.footer?.style, ...override.footer?.style },
    },
    footerCells: {
      style: { ...base.footerCells?.style, ...override.footerCells?.style },
    },
    noData: {
      style: { ...base.noData?.style, ...override.noData?.style },
    },
    progress: {
      style: { ...base.progress?.style, ...override.progress?.style },
    },
  };
}

export function AppDataTable<T>(
  props: AppDataTableProps<T>
): React.ReactElement {
  const {
    forceDark = false,
    colorMode,
    theme,
    customStyles,
    localization,
    paginationComponentOptions,
    noDataComponent,
    progressComponent,
    progressSkeleton = false,
    responsive = true,
    highlightOnHover = true,
    persistTableHead = true,
    ariaLabel,
    title,
    ...rest
  } = props;

  const { tx } = useAppI18n();
  const [domTheme, setDomTheme] = useState<ThemeMode>(() =>
    forceDark ? 'dark' : readDomThemeMode()
  );

  useEffect(() => {
    if (forceDark) {
      setDomTheme('dark');
      return;
    }

    const syncTheme = () => {
      setDomTheme(readDomThemeMode());
    };

    syncTheme();

    const observer =
      typeof MutationObserver !== 'undefined' && typeof document !== 'undefined'
        ? new MutationObserver(syncTheme)
        : null;

    if (observer && typeof document !== 'undefined') {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class'],
      });
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === null) {
        syncTheme();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.addEventListener('storage', onStorage);
    }

    return () => {
      observer?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
        window.removeEventListener('storage', onStorage);
      }
    };
  }, [forceDark]);

  const effectiveColorMode: 'light' | 'dark' = forceDark
    ? 'dark'
    : colorMode === 'dark' || colorMode === 'light'
      ? colorMode
      : domTheme;

  const isDark = effectiveColorMode === 'dark';

  const mergedPaginationOptions = useMemo<PaginationOptions>(
    () => ({
      rowsPerPageText: tx('Số dòng mỗi trang:', 'Rows per page:'),
      rangeSeparatorText: tx('trên', 'of'),
      selectAllRowsItemText: tx('Tất cả', 'All'),
      ...paginationComponentOptions,
    }),
    [tx, paginationComponentOptions]
  );

  const mergedLocalization = useMemo<Localization>(
    () => ({
      pagination: {
        navigationAriaLabel: tx('Phân trang bảng', 'Table pagination'),
        firstPageAriaLabel: tx('Trang đầu', 'First page'),
        previousPageAriaLabel: tx('Trang trước', 'Previous page'),
        nextPageAriaLabel: tx('Trang sau', 'Next page'),
        lastPageAriaLabel: tx('Trang cuối', 'Last page'),
        ...localization?.pagination,
      },
      filter: {
        filterColumnAriaLabel: tx('Lọc cột', 'Filter column'),
        filterActiveAriaLabel: tx('Đang lọc cột', 'Filter active'),
        filterPanelAriaLabel: tx('Bộ lọc cột', 'Column filter'),
        operatorAriaLabel: tx('Toán tử lọc', 'Filter operator'),
        valuePlaceholder: tx('Giá trị...', 'Value...'),
        valueAriaLabel: tx('Giá trị lọc', 'Filter value'),
        value2Placeholder: tx('Giá trị 2...', 'Second value...'),
        value2AriaLabel: tx('Giá trị lọc thứ hai', 'Filter second value'),
        betweenSeparatorText: tx('đến', 'and'),
        removeConditionAriaLabel: tx('Xóa điều kiện', 'Remove condition'),
        addConditionAriaLabel: tx(
          'Thêm điều kiện lọc thứ hai',
          'Add a second filter condition'
        ),
        addConditionLabel: tx('+ Thêm điều kiện', '+ Add condition'),
        clearLabel: tx('Xóa lọc', 'Clear'),
        applyLabel: tx('Áp dụng', 'Apply'),
        andLabel: tx('VÀ', 'AND'),
        orLabel: tx('HOẶC', 'OR'),
        selectAllLabel: tx('(Chọn tất cả)', '(Select all)'),
        selectAllFilteredAriaLabel: tx(
          '(Chọn tất cả) kết quả tìm kiếm',
          '(Select all) search results'
        ),
        blanksLabel: tx('(Trống)', '(Blanks)'),
        searchPlaceholder: tx('Tìm kiếm...', 'Search...'),
        searchAriaLabel: tx('Tìm giá trị lọc', 'Search filter values'),
        noMatchesText: tx('Không có kết quả khớp', 'No matches'),
        operators: {
          contains: tx('Chứa', 'Contains'),
          notContains: tx('Không chứa', 'Does not contain'),
          equals: tx('Bằng', 'Equals'),
          notEquals: tx('Khác', 'Does not equal'),
          startsWith: tx('Bắt đầu bằng', 'Begins with'),
          endsWith: tx('Kết thúc bằng', 'Ends with'),
          blank: tx('Trống', 'Blank'),
          notBlank: tx('Không trống', 'Not blank'),
          gt: tx('Lớn hơn', 'Greater than'),
          gte: tx('Lớn hơn hoặc bằng', 'Greater than or equal'),
          lt: tx('Nhỏ hơn', 'Less than'),
          lte: tx('Nhỏ hơn hoặc bằng', 'Less than or equal'),
          between: tx('Trong khoảng', 'Between'),
          before: tx('Trước', 'Before'),
          after: tx('Sau', 'After'),
          ...localization?.filter?.operators,
        },
        ...localization?.filter,
      },
      expandable: {
        expandRowAriaLabel: tx('Mở rộng dòng', 'Expand row'),
        collapseRowAriaLabel: tx('Thu gọn dòng', 'Collapse row'),
        ...localization?.expandable,
      },
      contextMenu: {
        headerMenuAriaLabel: tx('Menu cột', 'Column menu'),
        rowMenuAriaLabel: tx('Menu dòng', 'Row menu'),
        headerMenuButtonAriaLabel: tx('Thao tác cột', 'Column actions'),
        rowMenuButtonAriaLabel: tx('Thao tác dòng', 'Row actions'),
        sortAscLabel: tx('Sắp xếp tăng dần', 'Sort ascending'),
        sortDescLabel: tx('Sắp xếp giảm dần', 'Sort descending'),
        clearSortLabel: tx('Bỏ sắp xếp', 'Clear sort'),
        pinLeftLabel: tx('Ghim trái', 'Pin left'),
        pinRightLabel: tx('Ghim phải', 'Pin right'),
        unpinLabel: tx('Bỏ ghim', 'Unpin'),
        hideColumnLabel: tx('Ẩn cột', 'Hide column'),
        resetLabel: tx('Đặt lại bảng', 'Reset table'),
        ...localization?.contextMenu,
      },
    }),
    [tx, localization]
  );

  const baseStyles = useMemo<TableStyles>(
    () => ({
      responsiveWrapper: {
        style: {
          width: '100%',
          maxWidth: '100%',
          overflowX: 'auto',
        },
      },
      tableWrapper: {
        style: {
          width: '100%',
          display: 'block',
        },
      },
      table: {
        style: {
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          color: isDark ? '#f1f5f9' : '#0f172a',
        },
      },
      header: {
        style: {
          minHeight: '44px',
          paddingLeft: '16px',
          paddingRight: '16px',
          backgroundColor: isDark ? '#090d16' : '#f8fafc',
          color: isDark ? '#f8fafc' : '#0f172a',
          fontSize: '14px',
          fontWeight: 800,
        },
      },
      subHeader: {
        style: {
          minHeight: '44px',
          padding: '8px 16px',
          backgroundColor: isDark ? '#090d16' : '#f8fafc',
        },
      },
      headRow: {
        style: {
          minHeight: '40px',
          backgroundColor: isDark ? 'rgba(2, 6, 23, 0.7)' : '#f8fafc',
          borderBottomColor: isDark ? '#1e293b' : '#e2e8f0',
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
        },
        denseStyle: {
          minHeight: '34px',
        },
      },
      headCells: {
        style: {
          fontSize: '11px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: isDark ? '#94a3b8' : '#64748b',
          paddingLeft: '14px',
          paddingRight: '14px',
        },
      },
      rows: {
        style: {
          minHeight: '46px',
          fontSize: '13px',
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          color: isDark ? '#e2e8f0' : '#1e293b',
          borderBottomColor: isDark ? 'rgba(30, 41, 59, 0.75)' : '#f1f5f9',
        },
        denseStyle: {
          minHeight: '36px',
        },
        highlightOnHoverStyle: {
          backgroundColor: isDark ? 'rgba(30, 41, 59, 0.55)' : '#f8fafc',
          color: isDark ? '#f8fafc' : '#0f172a',
          transitionDuration: '120ms',
          outlineStyle: 'none',
        },
      },
      cells: {
        style: {
          paddingLeft: '14px',
          paddingRight: '14px',
          paddingTop: '8px',
          paddingBottom: '8px',
        },
      },
      footer: {
        style: {
          backgroundColor: isDark ? '#090d16' : '#f8fafc',
          color: isDark ? '#f8fafc' : '#0f172a',
        },
      },
      pagination: {
        style: {
          minHeight: '44px',
          fontSize: '12px',
          fontWeight: 600,
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          color: isDark ? '#94a3b8' : '#475569',
          borderTopColor: isDark ? '#1e293b' : '#e2e8f0',
        },
        pageButtonsStyle: {
          borderRadius: '8px',
          height: '32px',
          width: '32px',
          padding: '4px',
          margin: '0 2px',
        },
      },
      noData: {
        style: {
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          color: isDark ? '#94a3b8' : '#64748b',
          padding: '28px 16px',
        },
      },
      progress: {
        style: {
          backgroundColor: isDark ? '#0f172a' : '#ffffff',
          color: isDark ? '#94a3b8' : '#64748b',
          padding: '28px 16px',
        },
      },
    }),
    [isDark]
  );

  const mergedStyles = useMemo(
    () => mergeTableStyles(baseStyles, customStyles),
    [baseStyles, customStyles]
  );

  const defaultNoData = useMemo(
    () => (
      <div
        role="status"
        aria-live="polite"
        className={`py-6 text-center text-sm font-medium ${
          isDark ? 'text-slate-400' : 'text-slate-500'
        }`}
      >
        {tx('Không có dữ liệu để hiển thị.', 'No records to display.')}
      </div>
    ),
    [isDark, tx]
  );

  const defaultProgress = useMemo(
    () => (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center justify-center gap-2.5 py-6 text-sm font-semibold ${
          isDark ? 'text-slate-300' : 'text-slate-600'
        }`}
      >
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"
        />
        <span>{tx('Đang tải dữ liệu...', 'Loading data...')}</span>
      </div>
    ),
    [isDark, tx]
  );

  const resolvedAriaLabel =
    ariaLabel ??
    (typeof title === 'string' && title.trim().length > 0
      ? title
      : tx('Bảng dữ liệu', 'Data table'));

  return (
    <div
      className="w-full max-w-full min-w-0 overflow-hidden"
      data-color-mode={effectiveColorMode}
    >
      <DataTable<T>
        {...rest}
        title={title}
        ariaLabel={resolvedAriaLabel}
        theme={theme ?? QLAOK_TABLE_THEME}
        colorMode={effectiveColorMode}
        customStyles={mergedStyles}
        localization={mergedLocalization}
        paginationComponentOptions={mergedPaginationOptions}
        noDataComponent={noDataComponent ?? defaultNoData}
        progressComponent={progressComponent ?? defaultProgress}
        progressSkeleton={progressSkeleton}
        responsive={responsive}
        highlightOnHover={highlightOnHover}
        persistTableHead={persistTableHead}
      />
    </div>
  );
}

export default AppDataTable;
