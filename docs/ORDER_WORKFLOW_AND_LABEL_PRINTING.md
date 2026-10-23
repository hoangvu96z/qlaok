# Order Workflow & Production Label Printing

Updated: 24/10/2026. Technical documentation for the order fulfillment workflow lifecycle and production label printing feature in Qlaok.

## 1. Overview and Purpose

The order workflow and production label system allows store owners (F&B cafes, restaurants, bars, and retail/service shops) to tailor their fulfillment pipeline to match physical store operations, rather than forcing a rigid one-size-fits-all kitchen lifecycle.

Merchants can configure:
1. **Fulfillment Workflow**: Custom stages, step names, bilingual action labels, KDS routing, and customer-facing tracker labels.
2. **Production Labels & Cup Stickers**: Thermal cup stickers (50×30mm, 40×30mm) and kitchen prep slips (58mm, 80mm) with granular item-splitting modes, copies, display toggles, live modal preview, and independent reprint tracking.

### Settings Location & Access Control

Both configuration modules are located in the Merchant Web Dashboard:
- **Order Fulfillment Workflow Editor**: `/dashboard/settings#order-workflow-settings` (`ShopOrderWorkflowEditor.tsx`)
- **Production Labels & Cup Stickers Editor**: `/dashboard/settings#label-print-settings` (`ShopLabelPrintSettingsEditor.tsx`)

**Access Control & Storage:**
- Both editors are restricted to store owners and administrators (`owner` role or users with `shop.update` / `canManageSettings`). Staff and cashiers cannot modify workflow or label configurations.
- Settings are persisted inside `public.shops.theme_config` under keys:
  - `shops.theme_config.orderWorkflow` (typed as `ShopOrderWorkflowConfig`)
  - `shops.theme_config.labelPrintConfig` (typed as `ShopLabelPrintConfig`)
- Server-side mutation validation in `PATCH /api/shops` enforces `requireShopOwnerOrAdmin` when either configuration key is modified, and executes strict validation (`validateOrderWorkflowConfig` and `validateLabelPrintConfig`), returning HTTP 400 with detailed error arrays on invalid configurations.

---

## 2. Shipped Workflow Templates & Transitions

The workflow engine defines three canonical lifecycle stages (`OrderWorkflowStepStage`):
- `new` (rank 0): Initial receipt of the order.
- `preparing` (rank 1): Kitchen preparation, barista brewing, or order assembly.
- `completed` (rank 2): Service completed / order handed over to the customer.

Fulfillment workflows can contain between 2 and 8 steps (`MIN_WORKFLOW_STEPS = 2`, `MAX_WORKFLOW_STEPS = 8`). Step IDs must match `/^[a-z0-9][a-z0-9_-]{1,31}$/` and cannot use reserved words (`cancelled`, `cancel`, `canceled`).

### Built-in Templates

| Template ID | Name (VI / EN) | KDS Enabled | Steps | Typical Use Case |
| --- | --- | --- | --- | --- |
| `classic_kitchen` | Bếp nhà hàng truyền thống / Classic Kitchen | `true` | 1. `new` (Chờ bếp nhận)<br>2. `preparing` (Bếp đang làm)<br>3. `completed` (Đã phục vụ) | Dine-in restaurants, hot food kitchens with kitchen display monitors. |
| `counter_bar_serve` | Quầy pha chế & Giao món / Counter Bar & Serve | `false` | 1. `counter_received` (Thu ngân đã nhận)<br>2. `bar_making` (Quầy pha chế đang làm, `suggest_label_print: true`)<br>3. `served` (Đã giao món) | Coffee shops, milk tea bars, bakeries where baristas print cup stickers. |
| `simple_counter` | Bán nhanh tại quầy / Simple Counter | `false` | 1. `new` (Mới nhận tại quầy)<br>2. `completed` (Đã giao ngay) | Grab-and-go kiosks, fast food counters without prolonged prep stages. |
| `custom` | Tùy chỉnh theo quán / Custom Workflow | Configurable | Merchant-defined steps (2–8 steps) | Tailored workflows with multi-station prep or custom labeling. |

### Graph Validation Rules

A workflow configuration is validated by `validateOrderWorkflowConfig` against the following rules:
1. **Valid Start Step**: `start_step_id` must exist in `steps` and its stage must be `new`.
2. **Non-Regressive Transitions**: Transitions in `next_step_ids` must have a stage rank equal to or greater than the current step (`WORKFLOW_STAGE_RANK[target.stage] >= WORKFLOW_STAGE_RANK[current.stage]`). Backward transitions to earlier stages are strictly prohibited (`INVALID_STATE_TRANSITION`).
3. **Terminal Steps**: Steps with stage `completed` must have `next_step_ids: []`. Non-completed steps cannot have empty `next_step_ids` (no dead ends).
4. **Cycle Detection**: Directed acyclic graph (DAG) validation via depth-first search ensures no infinite loops exist.
5. **Full Reachability**: Every step in the workflow must be reachable from `start_step_id`.
6. **Isolated Payment Keys**: Workflow step definitions cannot include payment mutation fields (`payment_status`, `payment_method`, `mark_paid`, `auto_pay`, `collect_payment`, `refund`, `paid`).

---

## 3. Role-Based Behavior: Cashier, KDS, and Customer Tracker

### Cashier / Counter POS (`/dashboard/orders`)
- **Step Badges**: Each order card displays its resolved step badge via `resolveStaffOrderStepLabel`.
- **Dynamic Action Buttons**: Action buttons are computed via `getStaffOrderWorkflowActions`. Advancing an order sends `PATCH /api/orders` with `{ status: action.stage, workflow_step_id: action.stepId }` and requires the `orders.fulfill` permission.
- **Direct Label Print Action**: Each order card features a direct "In tem" / "Print labels" button with a `Tag` icon (`data-testid="order-print-labels-${order.id}"`). Clicking this button immediately opens `ReceiptPrintModal` on the `label` tab.

### Kitchen Display System (`/dashboard/kitchen`)
- **KDS Toggle Guard**: If `kds_enabled` is `false` in the store workflow, the KDS page displays an informative disabled state banner (`data-testid="kds-disabled-state"`), explaining that the shop operates on a direct counter/bar workflow without a separate kitchen display, and provides links to Counter Orders and Settings.
- **Selective Step Visibility**: When KDS is enabled, only steps configured with `show_on_kds: true` appear on KDS screens. Steps with `show_on_kds: false` (e.g. counter pickup) are excluded from the kitchen queue.
- **Touch Advance**: Kitchen tickets show step badges and touch-friendly advance buttons for staff with `orders.fulfill`.

### Customer Storefront Tracker (`ShowToStaffModal.tsx`)
- On the customer order tracking timeline (`/s/[slug]/menu`), the customer sees real-time progress.
- `resolveCurrentWorkflowCustomerLabel` dynamically displays the configured `customer_label_i18n` (falling back to `label_i18n`) for the current step (e.g., "Quầy đã nhận đơn", "Đang pha chế đồ uống", "Đã giao món xong").
- If the order has no `workflow_step_id` or an invalid step ID, the tracker falls back gracefully to standard canonical localized strings (`orderText.stepNew`, `orderText.stepPreparing`, `orderText.stepCompleted`).
- If an order is cancelled, the tracker reflects the cancelled status.

---

## 4. Business Invariants & Payment Decoupling

1. **Fulfillment and Payment Decoupling**:
   - Advancing workflow steps or marking service completed (`status: 'completed'`) **never** marks an order paid (`payment_status: 'paid'`).
   - In `dbCreateOrder`, staff creation with `markCompletedImmediately: true` initializes the order at the terminal completed workflow step (`resolveCompletedTerminalWorkflowStep`), but `payment_status` remains strictly dependent on whether payment was explicitly collected (`canCollectPayment && params.payment_status === 'paid'`).
   - Payment collection requires the separate `payment.collect` permission and transitions `payment_status` independently.
2. **Legacy Orders Compatibility**:
   - Existing orders created prior to workflow rollout have `workflow_step_id = NULL` in the database.
   - `resolveOrderCurrentWorkflowStep` resolves legacy orders dynamically from canonical `order.status`:
     - `status === 'new'` resolves to the workflow's `start_step_id`.
     - `status === 'preparing'` resolves to the first step configured with `stage === 'preparing'`.
     - `status === 'completed'` resolves to the completed step.
   - Legacy orders transition seamlessly to specific workflow steps upon their next staff action.
3. **Cancellation Invariant**:
   - Cancelling an order sets `status: 'cancelled'` and preserves the existing `workflow_step_id`. Passing a new `workflow_step_id` during cancellation is rejected with `INVALID_WORKFLOW_TRANSITION`.
   - Once an order is cancelled, subsequent workflow step mutations are blocked.

---

## 5. Production Label Options & Print Flow

### Supported Paper Presets

| Preset ID | Dimensions | Paper Type | Default Split Mode | Description |
| --- | --- | --- | --- | --- |
| `cup_sticker_50x30` | 50 × 30 mm | Die-cut Sticker | `per_item_unit` | Standard milk tea / coffee cup sticker |
| `cup_sticker_40x30` | 40 × 30 mm | Die-cut Sticker | `per_item_unit` | Compact cup sticker for smaller cups |
| `production_slip_58mm` | 58 mm width | Continuous Slip | `per_line_item` | 58mm thermal receipt paper roll |
| `production_slip_80mm` | 80 mm width | Continuous Slip | `single_ticket` | 80mm thermal kitchen/bar preparation ticket |

### Label Split Modes (`LabelSplitMode`)

1. `per_item_unit`: Generates one individual label for every single item unit. For example, an order with 3x Milk Tea produces 3 separate stickers, automatically indexed with sequence counters ("1/3", "2/3", "3/3").
2. `per_line_item`: Generates one label per order line item regardless of quantity, printing the line quantity badge (e.g. "x3").
3. `single_ticket`: Consolidates all line items, modifiers, and notes onto a single continuous ticket.

### Configuration Parameters & Safety Limits

- `copies_per_unit`: 1 to 5 copies per unit (default: 1).
- `max_labels_per_print`: 1 to 100 maximum labels per print job (default: 50).
  - **Runaway Guard**: If the computed label count exceeds `max_labels_per_print`, `buildProductionLabelBatch` rejects generation with error code `EXCEEDS_MAX_LABELS`, preventing thermal roll exhaustion.
- **Display Toggles**:
  - `show_shop_name` (default: `true`)
  - `show_order_code` (default: `true`)
  - `show_table_label` (default: `true`)
  - `show_item_name` (default: `true`)
  - `show_item_options` (default: `true`)
  - `show_item_note` (default: `true`)
  - `show_order_note` (default: `false`)
  - `show_sequence_counter` (default: `true`)
  - `show_timestamp` (default: `true`, formatted in deterministic UTC+7 `Asia/Ho_Chi_Minh`)
  - `show_price` (default: `false`)
  - `show_payment_qr` (default: `false`)
- **Custom Footer**:
  - Bilingual text (`custom_footer_i18n.vi` and `custom_footer_i18n.en`), maximum 120 characters.
  - Stripped of HTML tags and control characters to prevent formatting breakage.

### Opt-in VietQR Payment Code Eligibility Guard

When `show_payment_qr` is enabled, the VietQR payment code is rendered **only** when all of the following conditions are met:
1. `config.show_payment_qr === true` (explicit opt-in).
2. `order.payment_status === 'unpaid'` (**eligibility guard**: if the order is already paid, the QR code is automatically suppressed to prevent duplicate payments).
3. The store has valid VietQR bank account information configured (`getShopPaymentQrInfo`). If bank credentials are missing, the QR payload is omitted cleanly.

### Print Flow, Preview, and Independent Reprint Counter

1. **Entry**: Cashier clicks "In tem" on the order card in `/dashboard/orders` or selects the "In tem pha chế" tab inside `ReceiptPrintModal`.
2. **Preview**: The modal renders a live visual preview of the formatted labels (`data-testid="label-print-live-preview"`), showing exact typography, item options, modifiers, sequence tags, and footer.
3. **Execution**: Clicking "In tem" records the print request via `POST /api/orders` with `action: 'record_print'` and label type (the API accepts `ticketType` / `printType` aliases), requiring `orders.print_kitchen` permission; then triggers browser printing through a hidden iframe's `contentWindow.print()`. Recording the request only registers the print attempt on the server and updates reprint counters; it does not claim that physical printing succeeded.
4. **Independent Counter**:
   - `public.orders.label_printed_count` tracks the number of times labels have been printed for that order as a distinct counter.
   - On subsequent print jobs (`label_printed_count >= 1`), the system marks the output with an explicit **BẢN IN LẠI / REPRINT** banner and displays the reprint count (e.g. "Lần in: #2" / "Reprint #1"), distinct from kitchen, provisional, or customer receipt reprint counters.

---

## 6. Database Migrations & Compatibility

### Migration `016_order_workflow_and_label_printing.sql`
- Additive schema extension on `public.orders`: `workflow_step_id` (nullable) and `label_printed_count` (defaulting to 0) are added with `IF NOT EXISTS`, and the nonnegative check constraint (`orders_label_printed_count_check`, `label_printed_count >= 0`) is added only when absent.
- **Backward Compatibility**: Fully backward compatible. Existing orders have `workflow_step_id = NULL` and resolve dynamically from `orders.status`.

### Migration `017_order_workflow_rpc.sql`
- Updates atomic PL/pgSQL RPCs `public.commit_order_with_inventory` and `public.update_order_with_inventory` to persist `workflow_step_id` and `label_printed_count`.
- Preserves all database guarantees:
  - Deterministic item locking (`ORDER BY item_id ASC`) to eliminate deadlocks.
  - Idempotency key tracking (`idempotency_key`, `payment_idempotency_key`).
  - Table existence and active status verification.
  - Optimistic concurrency control (`bill_version`, `expected_updated_at`).
  - Customer edit pre-acceptance locks (`require_new_unpaid`).
  - Security definer execution with `REVOKE` from public/anon/authenticated and `GRANT` strictly to `service_role`.

---

## 7. Verification Evidence & Automated Tests

Automated coverage includes:
- **`npm run test:sql`**: Runs on isolated in-memory PGlite (`tests/sql-review.test.mjs`). Verifies migrations 016 and 017: column creation, defaults, non-null check constraints, idempotency on re-run, RPC execution for `commit_order_with_inventory` and `update_order_with_inventory`, and payment isolation.
- **`tests/order-workflow-review.test.ts`**:
  - Built-in template structure and step configurations.
  - Validation rules: step count bounds, ID regex, terminal completed steps, cycle detection, reachability, non-regressive stage transitions.
  - Runtime resolution: dynamic legacy order mapping, allowed next steps, customer label formatting, and payment field isolation.
- **`tests/label-print-settings-review.test.ts`**:
  - Configuration schema validation, paper preset specs, copies per unit bounds (1–5), max labels per print bounds (1–100).
  - Sanitization of custom footers (stripping HTML/control characters).
  - Owner-only authorization guards on `shops.theme_config`.
- **`tests/production-label-print-review.test.ts`**:
  - Batch generation across split modes (`per_item_unit`, `per_line_item`, `single_ticket`).
  - Total label calculations and quantity copy multipliers.
  - `EXCEEDS_MAX_LABELS` error enforcement.
- **`tests/production-label-template-review.test.ts`**:
  - Deterministic timestamp formatting in `Asia/Ho_Chi_Minh`.
  - HTML document rendering across all 4 paper presets.
  - Reprint banner stamping (`isReprint = true`).
  - VietQR payment code eligibility guard (unpaid-only check and suppression on paid orders).

---

## 8. Deployment Notes & Hardware Limitations

> [!NOTE]
> **Deployment State**: Automated SQL tests verify migrations in an isolated in-memory PGlite environment, distinct from the live production database. Migrations `016_order_workflow_and_label_printing.sql` and `017_order_workflow_rpc.sql` were applied to production by GitHub Actions run [#93](https://github.com/hoangvu96z/qlaok/actions/runs/40022080279) and deployment completed successfully for commit `1d106dfe5e646c09fd58689976f912b22ff34316` on 24/10/2026 (Asia/Ho_Chi_Minh). Future rollout status must be checked against the exact Actions run/SHA rather than treating this historical run as proof of later commits.

> [!IMPORTANT]
> **Physical Printer Limitations**:
> Print requests are prepared, rendered as HTML/CSS, and recorded in the database by the web application. Physical hardware printer output was **not** verified in this task.
>
> Thermal label printers (e.g. Xprinter, HPRT, TSC, Bixolon) communicate via the operating system print driver or browser print dialog. Merchants must verify physical printer alignment (page margins, label gap sensor calibration, print density, paper width) on their physical hardware.
