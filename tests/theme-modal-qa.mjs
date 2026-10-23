import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json', import.meta.url));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const theme=await import('../src/components/ui/ThemeToggle.tsx');
for(const [saved,system,expected] of [[null,true,'light'],['light',true,'light'],['dark',false,'dark'],['system',true,'dark'],['system',false,'light'],['invalid',true,'light']]){
 assert.equal(theme.getInitialTheme({getItem:()=>saved},system),expected);
}
assert.equal(theme.getStoredThemePreference({getItem(){throw Error('storage blocked');}}),'light');
console.log('PASS: default light, explicit theme and system preference resolution');
const originalWindow=globalThis.window;
try{
 const fakeWindow={};Object.defineProperty(fakeWindow,'localStorage',{get(){throw Error('storage getter blocked');}});globalThis.window=fakeWindow;
 assert.equal(theme.getStoredThemePreference(),'light');
 console.log('PASS: inaccessible localStorage getter falls back to light');
}finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
const {ShowToStaffModal, resolveCurrentWorkflowCustomerLabel}=await import('../src/components/storefront/ShowToStaffModal.tsx');
const shop={id:'qa-shop',slug:'qa',name:'Quán QA',vertical:'fnb',currency:'VND',theme_config:{},supported_langs:['vi','en']};
const tables=[{id:'qa-table',shop_id:shop.id,table_code:'T01',name:'Bàn Cửa Sổ',section:'',capacity:4,sort_order:1,is_active:true,is_archived:false}];
const cart=[{item:{id:'qa-item',shop_id:shop.id,price:65000,name_i18n:{vi:'Phở QA',en:'QA Pho'},desc_i18n:{vi:''},options_json:[]},quantity:1,selectedChoices:[],quickTags:['Không hành'],customNote:''}];
const html=renderToStaticMarkup(React.createElement(ShowToStaffModal,{isOpen:true,onClose(){},shop,locale:'vi',cart,tables,selectedTableId:'qa-table',initialTableLabel:tables[0].name,onUpdateQuantity(){},onClearCart(){}}));
assert.ok(html.includes('Bàn Cửa Sổ'));assert.ok(html.includes('Phở QA'));assert.ok(html.includes('65.000'));
assert.ok(html.includes('Mời quý khách kiểm tra lại món trước khi bấm nút gửi đến quầy.'));
assert.ok(!html.includes('Bàn 05'),'no fabricated example table chips');
assert.ok(html.includes('Không hành'), 'selected dietary notes must survive rendering');
console.log('PASS: actual confirmation component server-rendered with managed table and canonical cart labels');
for (const locale of ['ko','ja','zh','es','it','ru']) {
 const localized=renderToStaticMarkup(React.createElement(ShowToStaffModal,{isOpen:true,onClose(){},shop,locale,cart,tables:[],onUpdateQuantity(){},onClearCart(){}}));
 assert.doesNotMatch(localized,/No table selected|No dine-in tables|Please select an active table|Close order modal|aria-label="Payment method"|Decrease quantity|Increase quantity/, `${locale}: checkout system strings must use guest locale`);
}
console.log('PASS: all six non-VI/EN checkout locales avoid English system fallbacks');

// --- Regression tests: Configured workflow customer labels in guest order tracker ---
const customWorkflow = {
  template_id: 'custom',
  kds_enabled: true,
  start_step_id: 'order_received',
  steps: [
    {
      id: 'order_received',
      stage: 'new',
      label_i18n: { vi: 'Quầy tiếp nhận', en: 'Counter Received' },
      action_label_i18n: { vi: 'Tiếp nhận', en: 'Receive' },
      customer_label_i18n: { vi: 'Quầy đã nhận đơn', en: 'Order received at counter' },
      show_on_kds: true,
      suggest_label_print: false,
      next_step_ids: ['custom_baking'],
    },
    {
      id: 'custom_baking',
      stage: 'preparing',
      label_i18n: { vi: 'Nướng bánh lò than', en: 'Coal Oven Baking' },
      action_label_i18n: { vi: 'Nướng bánh', en: 'Bake' },
      customer_label_i18n: { vi: 'Đang nướng bánh lò than', en: 'Baking bread in coal oven' },
      show_on_kds: true,
      suggest_label_print: false,
      next_step_ids: ['handover'],
    },
    {
      id: 'handover',
      stage: 'completed',
      label_i18n: { vi: 'Đã giao khách', en: 'Handed to Guest' },
      action_label_i18n: { vi: 'Giao khách', en: 'Hand over' },
      customer_label_i18n: { vi: 'Đã trao tận tay khách', en: 'Handed directly to you' },
      show_on_kds: false,
      suggest_label_print: false,
      next_step_ids: [],
    },
  ],
};

const shopWithWorkflow = {
  ...shop,
  theme_config: {
    orderWorkflow: customWorkflow,
  },
};

const customOrderPreparing = {
  id: 'order-qa-1',
  order_code: 'QA-001',
  shop_id: shop.id,
  table_label: 'Bàn Cửa Sổ',
  visitor_lang: 'vi',
  status: 'preparing',
  workflow_step_id: 'custom_baking',
  payment_method: 'vietqr',
  payment_status: 'unpaid',
  total_amount: 65000,
  items: [{ item_id: 'qa-item', name_vi: 'Phở QA', quantity: 1, unit_price: 65000, extra_price: 0, selected_choices: [] }],
  source: 'qr_table',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// 1. Renders custom current step in VI
const trackerVi = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'vi',
    cart: [],
    activeOrderProp: customOrderPreparing,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerVi.includes('Đang nướng bánh lò than'), 'custom preparing step label must render in VI');
assert.ok(trackerVi.includes('Chờ quầy xác nhận'), 'canonical step 1 remains preserved');
assert.ok(trackerVi.includes('Đã phục vụ &amp; Hoàn tất') || trackerVi.includes('Đã phục vụ & Hoàn tất'), 'canonical step 3 remains preserved');
assert.ok(trackerVi.includes('data-testid="guest-order-tracker"'), 'tracker container must render');
assert.ok(trackerVi.includes('data-testid="guest-order-payment-badge"'), 'payment status badge preserved');

// 2. Renders custom current step in EN
const trackerEn = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'en',
    cart: [],
    activeOrderProp: customOrderPreparing,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerEn.includes('Baking bread in coal oven'), 'custom preparing step label must render in EN');
assert.ok(trackerEn.includes('Sent to Counter'), 'canonical step 1 remains preserved in EN');
assert.ok(trackerEn.includes('Served &amp; Completed') || trackerEn.includes('Served & Completed'), 'canonical step 3 remains preserved in EN');

// 3. Fallback for locales without specific translation (falls back to VI/EN per resolveWorkflowLocalizedText)
const trackerKo = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'ko',
    cart: [],
    activeOrderProp: customOrderPreparing,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerKo.includes('Đang nướng bánh lò than'), 'locale without translation falls back to VI');

// 4. Legacy order without workflow_step_id -> canonical status text
const legacyOrderNoStepId = {
  ...customOrderPreparing,
  workflow_step_id: undefined,
};
const trackerLegacyVi = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'vi',
    cart: [],
    activeOrderProp: legacyOrderNoStepId,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerLegacyVi.includes('Đang chuẩn bị / chế biến'), 'legacy order without step ID shows canonical status in VI');
assert.ok(!trackerLegacyVi.includes('Đang nướng bánh lò than'), 'must not show custom step when step ID is absent');

const trackerLegacyEn = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'en',
    cart: [],
    activeOrderProp: legacyOrderNoStepId,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerLegacyEn.includes('Preparing / Cooking'), 'legacy order without step ID shows canonical status in EN');

// 5. Legacy order with unknown or stale workflow_step_id -> canonical status text
const legacyOrderStaleStep = {
  ...customOrderPreparing,
  workflow_step_id: 'non_existent_step_404',
};
const trackerStaleVi = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'vi',
    cart: [],
    activeOrderProp: legacyOrderStaleStep,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerStaleVi.includes('Đang chuẩn bị / chế biến'), 'unknown step ID safely falls back to canonical status');

// Stage mismatch: order status is completed but workflow_step_id is preparing stage
const legacyOrderStageMismatch = {
  ...customOrderPreparing,
  status: 'completed',
  workflow_step_id: 'custom_baking',
};
const trackerMismatchVi = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'vi',
    cart: [],
    activeOrderProp: legacyOrderStageMismatch,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerMismatchVi.includes('Đã phục vụ &amp; Hoàn tất') || trackerMismatchVi.includes('Đã phục vụ & Hoàn tất'), 'stage mismatch safely falls back to canonical status');

// 6. Shop with missing or invalid workflow config -> canonical status text without throwing
const trackerMissingWorkflow = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: { ...shop, theme_config: {} },
    locale: 'vi',
    cart: [],
    activeOrderProp: customOrderPreparing,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerMissingWorkflow.includes('Đang chuẩn bị / chế biến'), 'missing workflow config falls back to canonical status');

const trackerInvalidWorkflow = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: { ...shop, theme_config: { orderWorkflow: { template_id: 'invalid', steps: [] } } },
    locale: 'vi',
    cart: [],
    activeOrderProp: customOrderPreparing,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerInvalidWorkflow.includes('Đang chuẩn bị / chế biến'), 'invalid workflow config falls back to canonical status without throwing');

// 7. Cancelled order preserves cancelled status view
const cancelledOrder = {
  ...customOrderPreparing,
  status: 'cancelled',
  workflow_step_id: 'custom_baking',
};
const trackerCancelled = renderToStaticMarkup(
  React.createElement(ShowToStaffModal, {
    isOpen: true,
    onClose() {},
    shop: shopWithWorkflow,
    locale: 'vi',
    cart: [],
    activeOrderProp: cancelledOrder,
    onUpdateQuantity() {},
    onClearCart() {},
  })
);
assert.ok(trackerCancelled.includes('data-testid="guest-order-cancelled"'), 'cancelled order preserves cancelled view');
assert.ok(!trackerCancelled.includes('Đang nướng bánh lò than'), 'cancelled order hides progress steps');

// 8. Direct unit tests of resolveCurrentWorkflowCustomerLabel
assert.equal(
  resolveCurrentWorkflowCustomerLabel(customOrderPreparing, shopWithWorkflow.theme_config, 'vi'),
  'Đang nướng bánh lò than'
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(customOrderPreparing, shopWithWorkflow.theme_config, 'en'),
  'Baking bread in coal oven'
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(customOrderPreparing, shopWithWorkflow.theme_config, 'ko'),
  'Đang nướng bánh lò than'
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(legacyOrderNoStepId, shopWithWorkflow.theme_config, 'vi'),
  null
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(legacyOrderStaleStep, shopWithWorkflow.theme_config, 'vi'),
  null
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(legacyOrderStageMismatch, shopWithWorkflow.theme_config, 'vi'),
  null
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(customOrderPreparing, {}, 'vi'),
  null
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(customOrderPreparing, { orderWorkflow: { bad: 1 } }, 'vi'),
  null
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(cancelledOrder, shopWithWorkflow.theme_config, 'vi'),
  null
);
assert.equal(
  resolveCurrentWorkflowCustomerLabel(null, shopWithWorkflow.theme_config, 'vi'),
  null
);

console.log('PASS: guest order tracker renders configured workflow labels in VI/EN with legacy fallback');
