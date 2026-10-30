import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  StorefrontProductImage,
  getVerticalDefaultEmoji,
} from '../src/components/storefront/StorefrontProductImage.tsx';
import { ItemDetailDrawer } from '../src/components/storefront/ItemDetailDrawer.tsx';
import { VerticalRenderer } from '../src/components/storefront/VerticalRenderer.tsx';
import { StorefrontFlashSaleSection } from '../src/components/storefront/StorefrontCustomDecor.tsx';

describe('Storefront Image Presentation Resilience', () => {
  it('maps business vertical to the correct fallback emoji', () => {
    assert.equal(getVerticalDefaultEmoji('fnb'), '🍜');
    assert.equal(getVerticalDefaultEmoji('service'), '💆‍♀️');
    assert.equal(getVerticalDefaultEmoji('retail'), '🛍️');
    // @ts-expect-error fallback check for unknown vertical
    assert.equal(getVerticalDefaultEmoji('other'), '🛍️');
  });

  it('StorefrontProductImage renders fallback emoji when src is missing or null', () => {
    const htmlNoSrc = renderToStaticMarkup(
      React.createElement(StorefrontProductImage, {
        alt: 'Phở bò',
        vertical: 'fnb',
      })
    );
    assert.ok(htmlNoSrc.includes('🍜'));
    assert.ok(htmlNoSrc.includes('role="img"'));
    assert.ok(htmlNoSrc.includes('data-testid="storefront-product-image-fallback"'));
    assert.ok(!htmlNoSrc.includes('<img'));

    const htmlNullSrc = renderToStaticMarkup(
      React.createElement(StorefrontProductImage, {
        src: null,
        alt: 'Spa Body',
        vertical: 'service',
      })
    );
    assert.ok(htmlNullSrc.includes('💆‍♀️'));
    assert.ok(!htmlNullSrc.includes('<img'));
  });

  it('StorefrontProductImage renders img element when valid src is provided', () => {
    const testUrl = 'https://example.com/item.png';
    const htmlWithSrc = renderToStaticMarkup(
      React.createElement(StorefrontProductImage, {
        src: testUrl,
        alt: 'Áo thun',
        vertical: 'retail',
      })
    );
    assert.ok(htmlWithSrc.includes('<img'));
    assert.ok(htmlWithSrc.includes('src="https://example.com/item.png"'));
    assert.ok(htmlWithSrc.includes('alt="Áo thun"'));
    assert.ok(!htmlWithSrc.includes('🛍️'));
  });

  it('handles image error fallback and resets failure state when src changes', () => {
    const clientInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const prevDispatcher = clientInternals ? clientInternals.H : null;

    let hookSlot = 0;
    let prevSrcState = undefined;
    let hasErrorState = false;

    const customDispatcher = {
      useState(initial) {
        hookSlot++;
        if (hookSlot === 1) {
          if (prevSrcState === undefined) prevSrcState = initial;
          return [
            prevSrcState,
            (val) => {
              prevSrcState = typeof val === 'function' ? val(prevSrcState) : val;
            },
          ];
        } else {
          return [
            hasErrorState,
            (val) => {
              hasErrorState = typeof val === 'function' ? val(hasErrorState) : Boolean(val);
            },
          ];
        }
      },
    };

    if (clientInternals) {
      clientInternals.H = customDispatcher;
    }

    try {
      // 1. Initial render with broken URL
      hookSlot = 0;
      let rendered = StorefrontProductImage({
        src: 'https://example.com/broken.png',
        alt: 'Cà phê sữa',
        vertical: 'fnb',
      });
      assert.equal(rendered.type, 'img');
      assert.equal(rendered.props.src, 'https://example.com/broken.png');
      assert.equal(rendered.props.alt, 'Cà phê sữa');
      assert.equal(typeof rendered.props.onError, 'function');
      assert.equal(hasErrorState, false);

      // 2. Simulate image decode error (e.g. HTTP 402 or network error)
      rendered.props.onError({});
      assert.equal(hasErrorState, true);

      // 3. Re-render after error triggers fallback emoji
      hookSlot = 0;
      rendered = StorefrontProductImage({
        src: 'https://example.com/broken.png',
        alt: 'Cà phê sữa',
        vertical: 'fnb',
      });
      assert.equal(rendered.type, 'div');
      assert.equal(rendered.props.role, 'img');
      assert.equal(rendered.props.children, '🍜');
      assert.equal(rendered.props['data-testid'], 'storefront-product-image-fallback');

      // 4. Updating src to a new image URL resets failure state
      hookSlot = 0;
      rendered = StorefrontProductImage({
        src: 'https://example.com/new-valid.png',
        alt: 'Cà phê sữa mới',
        vertical: 'fnb',
      });
      assert.equal(hasErrorState, false);
      assert.equal(rendered.type, 'img');
      assert.equal(rendered.props.src, 'https://example.com/new-valid.png');
    } finally {
      if (clientInternals) {
        clientInternals.H = prevDispatcher;
      }
    }
  });

  it('ItemDetailDrawer preserves h-52 area and controls when item has image_url', () => {
    const itemWithImage = {
      id: 'test-item-1',
      shop_id: 'shop-test',
      category_id: 'cat-1',
      sort_order: 1,
      name_i18n: { vi: 'Bún bò Huế' },
      desc_i18n: { vi: '' },
      options_json: [],
      view_count: 0,
      price: 55000,
      image_url: 'https://example.com/bun-bo.jpg',
      is_available: true,
      is_featured: true,
    };

    const htmlWithImg = renderToStaticMarkup(
      React.createElement(ItemDetailDrawer, {
        item: itemWithImage,
        vertical: 'fnb',
        locale: 'vi',
        onClose: () => {},
        onAddToCart: () => {},
      })
    );

    // Image container h-52 is preserved
    assert.ok(htmlWithImg.includes('h-52 w-full shrink-0 bg-slate-100'));
    // Close button and featured badge are present in header
    assert.ok(htmlWithImg.includes('aria-label="Đóng chi tiết món"'));
    assert.ok(htmlWithImg.includes('Bán chạy'));
    assert.ok(htmlWithImg.includes('src="https://example.com/bun-bo.jpg"'));
  });

  it('ItemDetailDrawer maintains compact header when item has no image_url', () => {
    const itemNoImage = {
      id: 'test-item-2',
      shop_id: 'shop-test',
      category_id: 'cat-1',
      sort_order: 2,
      name_i18n: { vi: 'Trà đá' },
      desc_i18n: { vi: '' },
      options_json: [],
      view_count: 0,
      price: 5000,
      image_url: null,
      is_available: true,
      is_featured: false,
    };

    const htmlNoImg = renderToStaticMarkup(
      React.createElement(ItemDetailDrawer, {
        item: itemNoImage,
        vertical: 'fnb',
        locale: 'vi',
        onClose: () => {},
        onAddToCart: () => {},
      })
    );

    // Compact header without h-52
    assert.ok(!htmlNoImg.includes('h-52 w-full'));
    assert.ok(htmlNoImg.includes('Qlaok Smart Menu'));
    assert.ok(htmlNoImg.includes('aria-label="Đóng chi tiết món"'));
  });

  it('VerticalRenderer uses StorefrontProductImage in 2-column grid and list views', () => {
    const categories = [
      { id: 'cat-1', shop_id: 'shop-test', name_i18n: { vi: 'Món chính' }, sort_order: 1, is_active: true },
    ];
    const items = [
      {
        id: 'item-1',
        shop_id: 'shop-test',
        category_id: 'cat-1',
        sort_order: 1,
        name_i18n: { vi: 'Sản phẩm có ảnh' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
        price: 100000,
        image_url: 'https://example.com/product.jpg',
        is_available: true,
        is_featured: false,
      },
      {
        id: 'item-2',
        shop_id: 'shop-test',
        category_id: 'cat-1',
        sort_order: 2,
        name_i18n: { vi: 'Sản phẩm không ảnh' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
        price: 80000,
        image_url: null,
        is_available: true,
        is_featured: false,
      },
    ];

    // Retail vertical defaults to grid layout
    const gridHtml = renderToStaticMarkup(
      React.createElement(VerticalRenderer, {
        vertical: 'retail',
        categories,
        items,
        locale: 'vi',
        selectedCategoryId: 'all',
        searchQuery: '',
        onSelectItem: () => {},
        onQuickAdd: () => {},
      })
    );

    // Grid contains img for item-1 and retail emoji 🛍️ for item-2
    assert.ok(gridHtml.includes('src="https://example.com/product.jpg"'));
    assert.ok(gridHtml.includes('🛍️'));

    // F&B vertical list view
    const fnbHtml = renderToStaticMarkup(
      React.createElement(VerticalRenderer, {
        vertical: 'fnb',
        categories,
        items,
        locale: 'vi',
        selectedCategoryId: 'all',
        searchQuery: '',
        onSelectItem: () => {},
        onQuickAdd: () => {},
      })
    );

    // F&B list view contains img for item-1 and fnb emoji 🍜 for item-2
    assert.ok(fnbHtml.includes('src="https://example.com/product.jpg"'));
    assert.ok(fnbHtml.includes('🍜'));
  });

  it('StorefrontFlashSaleSection uses the shared image fallback for sale items', () => {
    const flashSaleShop = {
      id: 'shop-test',
      vertical: 'fnb',
      currency: 'VND',
      theme_config: {
        flashSale: {
          enabled: true,
          title: 'Ưu đãi',
          discountType: 'percent',
          discountValue: 25,
          itemIds: ['sale-item'],
        },
      },
    };
    const saleItem = {
      id: 'sale-item',
      shop_id: 'shop-test',
      category_id: 'cat-1',
      sort_order: 1,
      name_i18n: { vi: 'Món khuyến mãi' },
      desc_i18n: { vi: '' },
      options_json: [],
      view_count: 0,
      price: 100000,
      compare_at_price: null,
      image_url: 'https://example.com/sale-item.jpg',
      is_available: true,
      is_featured: false,
    };
    const html = renderToStaticMarkup(
      React.createElement(StorefrontFlashSaleSection, {
        shop: flashSaleShop,
        items: [saleItem],
        locale: 'vi',
      })
    );

    assert.ok(html.includes('src="https://example.com/sale-item.jpg"'));
    assert.ok(html.includes('data-testid="storefront-product-image"'));
    assert.ok(html.includes('Món khuyến mãi'));
    assert.ok(html.includes('-25%'));
  });
});
