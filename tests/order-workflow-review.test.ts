import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PATCH as patchOrders, POST as postOrders } from '@/app/api/orders/route';
import { GET as getShops, PATCH as patchShops } from '@/app/api/shops/route';
import {
  dbGetAllShopsAndProfile,
  dbGetShopById,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import {
  dbCreateOrder,
  dbGetOrderById,
  setMposDbClientForTests,
} from '@/lib/mpos-store';
import {
  BUILT_IN_ORDER_WORKFLOW_TEMPLATES,
  DEFAULT_SHOP_LABEL_PRINT_CONFIG,
  DEFAULT_SHOP_ORDER_WORKFLOW_CONFIG,
  getAllowedNextWorkflowSteps,
  getBuiltInOrderWorkflowTemplate,
  getDefaultShopLabelPrintConfig,
  LABEL_PAPER_PRESET_SPECS,
  resolveLabelLocalizedText,
  resolveOrderCurrentWorkflowStep,
  resolveShopLabelPrintConfig,
  resolveShopOrderWorkflowConfig,
  resolveWorkflowLocalizedText,
  validateLabelPrintConfig,
  validateOrderWorkflowConfig,
  validateOrderWorkflowTransition,
} from '@/lib/order-workflow';
import { issueSessionToken } from '@/lib/server-auth';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import { setShopTablesDbClientForTests } from '@/lib/shop-tables';
import type { Shop, ShopOrder, ShopThemeConfig } from '@/types/qlaok';

test('built-in workflow templates validate and preserve immutability and KDS/label flags', () => {
  for (const templateId of [
    'classic_kitchen',
    'counter_bar_serve',
    'simple_counter',
  ] as const) {
    const template = getBuiltInOrderWorkflowTemplate(templateId);
    const result = validateOrderWorkflowConfig(template);
    assert.equal(
      result.valid,
      true,
      `Template ${templateId} must validate cleanly`
    );
    assert.equal(result.config?.template_id, templateId);
  }

  // 1. classic_kitchen: new -> preparing -> completed, active kitchen steps visible on KDS
  const classic = getBuiltInOrderWorkflowTemplate('classic_kitchen');
  assert.equal(classic.kds_enabled, true);
  assert.equal(classic.start_step_id, 'new');
  assert.deepEqual(
    classic.steps.map((s) => ({
      id: s.id,
      stage: s.stage,
      show_on_kds: s.show_on_kds,
      next: s.next_step_ids,
    })),
    [
      { id: 'new', stage: 'new', show_on_kds: true, next: ['preparing'] },
      {
        id: 'preparing',
        stage: 'preparing',
        show_on_kds: true,
        next: ['completed'],
      },
      {
        id: 'completed',
        stage: 'completed',
        show_on_kds: false,
        next: [],
      },
    ]
  );

  // 2. counter_bar_serve: counter_received (new) -> bar_making (preparing, no KDS, suggest label) -> served (completed)
  const counterBar = getBuiltInOrderWorkflowTemplate('counter_bar_serve');
  assert.equal(counterBar.kds_enabled, false);
  assert.equal(counterBar.start_step_id, 'counter_received');
  assert.deepEqual(
    counterBar.steps.map((s) => ({
      id: s.id,
      stage: s.stage,
      show_on_kds: s.show_on_kds,
      suggest_label_print: s.suggest_label_print,
      next: s.next_step_ids,
    })),
    [
      {
        id: 'counter_received',
        stage: 'new',
        show_on_kds: false,
        suggest_label_print: false,
        next: ['bar_making'],
      },
      {
        id: 'bar_making',
        stage: 'preparing',
        show_on_kds: false,
        suggest_label_print: true,
        next: ['served'],
      },
      {
        id: 'served',
        stage: 'completed',
        show_on_kds: false,
        suggest_label_print: false,
        next: [],
      },
    ]
  );

  // 3. simple_counter: new -> completed directly
  const simple = getBuiltInOrderWorkflowTemplate('simple_counter');
  assert.equal(simple.kds_enabled, false);
  assert.equal(simple.start_step_id, 'new');
  assert.deepEqual(
    simple.steps.map((s) => ({
      id: s.id,
      stage: s.stage,
      show_on_kds: s.show_on_kds,
      next: s.next_step_ids,
    })),
    [
      { id: 'new', stage: 'new', show_on_kds: false, next: ['completed'] },
      {
        id: 'completed',
        stage: 'completed',
        show_on_kds: false,
        next: [],
      },
    ]
  );

  // Mutating a cloned template does not mutate BUILT_IN_ORDER_WORKFLOW_TEMPLATES
  counterBar.steps[0].next_step_ids.push('served');
  assert.deepEqual(
    BUILT_IN_ORDER_WORKFLOW_TEMPLATES.counter_bar_serve.steps[0].next_step_ids,
    ['bar_making']
  );
  assert.equal(
    DEFAULT_SHOP_ORDER_WORKFLOW_CONFIG.template_id,
    'classic_kitchen'
  );
});

test('custom multi-step branching workflow validates custom step IDs separate from canonical stage and resolves VI/EN fallbacks', () => {
  const customBranching = {
    template_id: 'custom',
    kds_enabled: true,
    start_step_id: 'cashier_intake',
    steps: [
      {
        id: 'cashier_intake',
        stage: 'new',
        label_i18n: { vi: 'Thu ngân nhận đơn' },
        action_label_i18n: { en: 'Accept at Counter' },
        show_on_kds: false,
        next_step_ids: ['espresso_station', 'blended_station'],
      },
      {
        id: 'espresso_station',
        stage: 'preparing',
        label_i18n: { vi: 'Quầy máy pha cafe', en: 'Espresso Bar' },
        show_on_kds: true,
        suggest_label_print: true,
        next_step_ids: ['quality_pass'],
      },
      {
        id: 'blended_station',
        stage: 'preparing',
        label_i18n: { vi: 'Quầy đá xay', en: 'Blended Station' },
        show_on_kds: true,
        suggest_label_print: true,
        next_step_ids: ['quality_pass', 'pickup_counter'],
      },
      {
        id: 'quality_pass',
        stage: 'preparing',
        label_i18n: { vi: 'Kiểm tra & đóng nắp', en: 'Topping & Seal' },
        show_on_kds: false,
        next_step_ids: ['pickup_counter'],
      },
      {
        id: 'pickup_counter',
        stage: 'completed',
        label_i18n: { vi: 'Đã giao tại quầy', en: 'Handed to Guest' },
        show_on_kds: true, // Completed steps normalize show_on_kds to false
        next_step_ids: [],
      },
    ],
  };

  const res = validateOrderWorkflowConfig(customBranching);
  assert.equal(res.valid, true);
  assert.ok(res.config);
  assert.equal(res.config.steps.length, 5);

  // Verify VI/EN fallback normalization
  const intakeStep = res.config.steps[0];
  assert.deepEqual(intakeStep.label_i18n, {
    vi: 'Thu ngân nhận đơn',
    en: 'Thu ngân nhận đơn',
  });
  assert.deepEqual(intakeStep.action_label_i18n, {
    vi: 'Accept at Counter',
    en: 'Accept at Counter',
  });
  assert.deepEqual(intakeStep.customer_label_i18n, {
    vi: 'Thu ngân nhận đơn',
    en: 'Thu ngân nhận đơn',
  });
  assert.equal(
    resolveWorkflowLocalizedText(intakeStep.label_i18n, 'ko'),
    'Thu ngân nhận đơn'
  );
  assert.equal(
    resolveWorkflowLocalizedText(res.config.steps[1].label_i18n, 'en'),
    'Espresso Bar'
  );

  // Completed step forces show_on_kds to false
  const completedStep = res.config.steps[4];
  assert.equal(completedStep.show_on_kds, false);
});

test('workflow validator rejects malformed graphs: cycles, unreachable nodes, dead ends, stage regressions, multiple new steps, invalid IDs, cancellation nodes, >8 steps, and payment mutations', () => {
  // 1. Cycle between preparing steps
  const cycleRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới', en: 'New' },
        show_on_kds: false,
        next_step_ids: ['prep_a'],
      },
      {
        id: 'prep_a',
        stage: 'preparing',
        label_i18n: { vi: 'Pha A', en: 'Prep A' },
        show_on_kds: false,
        next_step_ids: ['prep_b'],
      },
      {
        id: 'prep_b',
        stage: 'preparing',
        label_i18n: { vi: 'Pha B', en: 'Prep B' },
        show_on_kds: false,
        next_step_ids: ['prep_a', 'step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong', en: 'Done' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(cycleRes.valid, false);
  assert.ok(
    cycleRes.errors.some((e) => e.code === 'WORKFLOW_CYCLE_DETECTED'),
    'Must reject cycle prep_a -> prep_b -> prep_a'
  );

  // 2. Self-loop edge
  const selfLoopRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['prep_a'],
      },
      {
        id: 'prep_a',
        stage: 'preparing',
        label_i18n: { vi: 'Pha' },
        show_on_kds: false,
        next_step_ids: ['prep_a', 'step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(selfLoopRes.valid, false);
  assert.ok(selfLoopRes.errors.some((e) => e.code === 'SELF_LOOP_EDGE'));

  // 3. Unreachable step from start_step_id
  const unreachableRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['step_done'],
      },
      {
        id: 'orphan_prep',
        stage: 'preparing',
        label_i18n: { vi: 'Bước cô lập' },
        show_on_kds: false,
        next_step_ids: ['step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(unreachableRes.valid, false);
  assert.ok(
    unreachableRes.errors.some(
      (e) => e.code === 'UNREACHABLE_STEP' && e.step_id === 'orphan_prep'
    )
  );

  // 4. Dead-end non-completed step (no outgoing edges)
  const deadEndRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['dead_prep', 'step_done'],
      },
      {
        id: 'dead_prep',
        stage: 'preparing',
        label_i18n: { vi: 'Bước cụt' },
        show_on_kds: false,
        next_step_ids: [],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(deadEndRes.valid, false);
  assert.ok(
    deadEndRes.errors.some(
      (e) => e.code === 'DEAD_END_STEP' && e.step_id === 'dead_prep'
    )
  );

  // 5. Stage regression edge (preparing -> new, or completed -> preparing)
  const regressionRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['prep_1'],
      },
      {
        id: 'prep_1',
        stage: 'preparing',
        label_i18n: { vi: 'Đang làm' },
        show_on_kds: false,
        next_step_ids: ['step_new', 'step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(regressionRes.valid, false);
  assert.ok(
    regressionRes.errors.some((e) => e.code === 'STAGE_REGRESSION_EDGE')
  );

  // 6. Multiple stage='new' steps (violates single new-stage start step invariant)
  const multipleNewRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'new_1',
    steps: [
      {
        id: 'new_1',
        stage: 'new',
        label_i18n: { vi: 'Mới 1' },
        show_on_kds: false,
        next_step_ids: ['new_2'],
      },
      {
        id: 'new_2',
        stage: 'new',
        label_i18n: { vi: 'Mới 2' },
        show_on_kds: false,
        next_step_ids: ['step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(multipleNewRes.valid, false);
  assert.ok(
    multipleNewRes.errors.some((e) => e.code === 'MULTIPLE_NEW_STAGE_STEPS')
  );

  // 7. Terminal completed step with outgoing edges
  const terminalOutgoingRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['done_1'],
      },
      {
        id: 'done_1',
        stage: 'completed',
        label_i18n: { vi: 'Xong 1' },
        show_on_kds: false,
        next_step_ids: ['done_2'],
      },
      {
        id: 'done_2',
        stage: 'completed',
        label_i18n: { vi: 'Xong 2' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(terminalOutgoingRes.valid, false);
  assert.ok(
    terminalOutgoingRes.errors.some(
      (e) => e.code === 'TERMINAL_STEP_HAS_OUTGOING_EDGES'
    )
  );

  // 8. Cancellation node rejected
  const cancelNodeRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['cancelled'],
      },
      {
        id: 'cancelled',
        stage: 'cancelled',
        label_i18n: { vi: 'Đã hủy' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(cancelNodeRes.valid, false);
  assert.ok(
    cancelNodeRes.errors.some(
      (e) => e.code === 'CANCELLATION_NOT_ALLOWED_IN_WORKFLOW'
    )
  );

  // 9. Duplicate IDs and invalid IDs
  const dupIdRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['step_new'],
      },
      {
        id: 'step_new',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(dupIdRes.valid, false);
  assert.ok(dupIdRes.errors.some((e) => e.code === 'DUPLICATE_STEP_ID'));

  const badIdRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'Bad Step ID!',
    steps: [
      {
        id: 'Bad Step ID!',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['done'],
      },
      {
        id: 'done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(badIdRes.valid, false);
  assert.ok(badIdRes.errors.some((e) => e.code === 'INVALID_STEP_ID'));

  // 10. >8 steps rejected
  const nineSteps = [
    {
      id: 'step_0',
      stage: 'new',
      label_i18n: { vi: 'B0' },
      show_on_kds: false,
      next_step_ids: ['step_1'],
    },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `step_${i + 1}`,
      stage: 'preparing',
      label_i18n: { vi: `B${i + 1}` },
      show_on_kds: false,
      next_step_ids: [`step_${i + 2}`],
    })),
    {
      id: 'step_8',
      stage: 'completed',
      label_i18n: { vi: 'B8' },
      show_on_kds: false,
      next_step_ids: [],
    },
  ];
  assert.equal(nineSteps.length, 9);
  const tooManyRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_0',
    steps: nineSteps,
  });
  assert.equal(tooManyRes.valid, false);
  assert.ok(tooManyRes.errors.some((e) => e.code === 'TOO_MANY_STEPS'));

  // 11. Forbidden payment mutation field on step or config
  const paymentMutationRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: 'Mới' },
        show_on_kds: false,
        next_step_ids: ['step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        mark_paid: true,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(paymentMutationRes.valid, false);
  assert.ok(
    paymentMutationRes.errors.some(
      (e) => e.code === 'FORBIDDEN_PAYMENT_MUTATION_FIELD'
    )
  );

  // 12. Unsafe HTML in label rejected
  const unsafeLabelRes = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: false,
    start_step_id: 'step_new',
    steps: [
      {
        id: 'step_new',
        stage: 'new',
        label_i18n: { vi: '<script>alert(1)</script>' },
        show_on_kds: false,
        next_step_ids: ['step_done'],
      },
      {
        id: 'step_done',
        stage: 'completed',
        label_i18n: { vi: 'Xong' },
        show_on_kds: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(unsafeLabelRes.valid, false);
  assert.ok(unsafeLabelRes.errors.some((e) => e.code === 'UNSAFE_STEP_LABEL'));
});

test('workflow step resolution and transition validation enforce graph edges and preserve payment independence', () => {
  const counterBar = getBuiltInOrderWorkflowTemplate('counter_bar_serve');

  // Legacy or newly created order with workflow_step_id: null resolves to counter_received
  const orderAtStart: Pick<
    ShopOrder,
    'status' | 'workflow_step_id' | 'payment_status'
  > = {
    status: 'new',
    workflow_step_id: null,
    payment_status: 'unpaid',
  };

  const current0 = resolveOrderCurrentWorkflowStep(orderAtStart, counterBar);
  assert.equal(current0?.id, 'counter_received');
  assert.equal(current0?.stage, 'new');
  assert.deepEqual(
    getAllowedNextWorkflowSteps(orderAtStart, counterBar).map((s) => s.id),
    ['bar_making']
  );

  // Skipping bar_making directly to served is rejected because counter_received -> served is not an edge
  const skipAttempt = validateOrderWorkflowTransition({
    order: orderAtStart,
    nextStepId: 'served',
    workflowConfig: counterBar,
  });
  assert.equal(skipAttempt.valid, false);
  if (!skipAttempt.valid) {
    assert.equal(skipAttempt.code, 'INVALID_WORKFLOW_TRANSITION');
  }

  // Valid transition 1: counter_received -> bar_making
  const toBar = validateOrderWorkflowTransition({
    order: orderAtStart,
    nextStepId: 'bar_making',
    workflowConfig: counterBar,
  });
  assert.equal(toBar.valid, true);
  if (toBar.valid) {
    assert.equal(toBar.nextStep.id, 'bar_making');
    assert.equal(toBar.nextStatus, 'preparing');
    assert.equal(toBar.nextStep.suggest_label_print, true);
  }

  // Once advanced to bar_making, canonical status is 'preparing' (customer pre-acceptance lock engages)
  const orderInBar: Pick<
    ShopOrder,
    'status' | 'workflow_step_id' | 'payment_status'
  > = {
    status: 'preparing',
    workflow_step_id: 'bar_making',
    payment_status: 'unpaid',
  };

  // Valid transition 2: bar_making -> served
  const toServed = validateOrderWorkflowTransition({
    order: orderInBar,
    nextStepId: 'served',
    workflowConfig: counterBar,
  });
  assert.equal(toServed.valid, true);
  if (toServed.valid) {
    assert.equal(toServed.nextStep.id, 'served');
    assert.equal(toServed.nextStatus, 'completed');
    // Transitioning to served returns only nextStatus = 'completed' and never alters payment_status
    assert.equal('payment_status' in toServed, false);
  }

  // Cancelled orders have no workflow step and cannot transition
  const cancelledOrder: Pick<ShopOrder, 'status' | 'workflow_step_id'> = {
    status: 'cancelled',
    workflow_step_id: 'bar_making',
  };
  assert.equal(
    resolveOrderCurrentWorkflowStep(cancelledOrder, counterBar),
    null
  );
  assert.deepEqual(
    getAllowedNextWorkflowSteps(cancelledOrder, counterBar),
    []
  );
  const cancelledAttempt = validateOrderWorkflowTransition({
    order: cancelledOrder,
    nextStepId: 'served',
    workflowConfig: counterBar,
  });
  assert.equal(cancelledAttempt.valid, false);
  if (!cancelledAttempt.valid) {
    assert.equal(cancelledAttempt.code, 'ORDER_CANCELLED');
  }

  // Open order with an orphaned workflow_step_id (after shop owner edits config) falls back to stage match
  const orphanedOrder: Pick<ShopOrder, 'status' | 'workflow_step_id'> = {
    status: 'preparing',
    workflow_step_id: 'removed_step_id',
  };
  const fallbackStep = resolveOrderCurrentWorkflowStep(
    orphanedOrder,
    counterBar
  );
  assert.equal(fallbackStep?.id, 'bar_making');

  // resolveShopOrderWorkflowConfig falls back to classic_kitchen when theme_config has no orderWorkflow or invalid data
  const emptyTheme = {
    primaryColor: '#10b981',
    layout: 'grid',
  } as ShopThemeConfig;
  assert.equal(
    resolveShopOrderWorkflowConfig(emptyTheme).template_id,
    'classic_kitchen'
  );
});

test('ShopLabelPrintConfig defaults to 50x30mm cup sticker per-item-unit without price/QR and validates presets and bounds', () => {
  const def = getDefaultShopLabelPrintConfig();
  assert.deepEqual(def, DEFAULT_SHOP_LABEL_PRINT_CONFIG);
  assert.equal(def.enabled, true);
  assert.equal(def.paper_preset, 'cup_sticker_50x30');
  assert.equal(def.split_mode, 'per_item_unit');
  assert.equal(def.copies_per_unit, 1);
  assert.equal(def.show_order_code, true);
  assert.equal(def.show_table_label, true);
  assert.equal(def.show_item_name, true);
  assert.equal(def.show_item_options, true);
  assert.equal(def.show_item_note, true);
  assert.equal(def.show_price, false);
  assert.equal(def.show_payment_qr, false);
  assert.equal('customer_name' in def, false);
  assert.equal('show_customer_name' in def, false);

  assert.equal(LABEL_PAPER_PRESET_SPECS.cup_sticker_50x30.width_mm, 50);
  assert.equal(LABEL_PAPER_PRESET_SPECS.cup_sticker_40x30.width_mm, 40);
  assert.equal(LABEL_PAPER_PRESET_SPECS.production_slip_58mm.width_mm, 58);
  assert.equal(LABEL_PAPER_PRESET_SPECS.production_slip_80mm.width_mm, 80);

  // Valid custom label configurations across all supported paper presets & split modes
  for (const preset of [
    'cup_sticker_50x30',
    'cup_sticker_40x30',
    'production_slip_58mm',
    'production_slip_80mm',
  ] as const) {
    for (const splitMode of [
      'per_item_unit',
      'per_line_item',
      'single_ticket',
    ] as const) {
      const validRes = validateLabelPrintConfig({
        enabled: true,
        paper_preset: preset,
        split_mode: splitMode,
        copies_per_unit: 2,
        max_labels_per_print: 80,
        show_order_code: true,
        show_table_label: true,
        show_item_name: true,
        show_item_options: true,
        show_item_note: true,
        show_price: false,
        show_payment_qr: false,
        custom_footer_i18n: { vi: 'Chúc quý khách ngon miệng!' },
      });
      assert.equal(validRes.valid, true);
      assert.equal(validRes.config?.paper_preset, preset);
      assert.equal(validRes.config?.split_mode, splitMode);
      assert.equal(
        resolveLabelLocalizedText(validRes.config?.custom_footer_i18n, 'en'),
        'Chúc quý khách ngon miệng!'
      );
    }
  }

  // Reject invalid paper_preset and split_mode
  const badPaper = validateLabelPrintConfig({
    paper_preset: 'a4_sheet',
    split_mode: 'per_order_custom',
  });
  assert.equal(badPaper.valid, false);
  assert.ok(badPaper.errors.some((e) => e.code === 'INVALID_PAPER_PRESET'));
  assert.ok(badPaper.errors.some((e) => e.code === 'INVALID_SPLIT_MODE'));

  // Reject out-of-range copies_per_unit and max_labels_per_print
  for (const badCopies of [0, -1, 6, 1.5, Number.NaN]) {
    const res = validateLabelPrintConfig({ copies_per_unit: badCopies });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.code === 'INVALID_COPIES_PER_UNIT'));
  }

  for (const badMax of [0, -10, 101, 500, 2.5]) {
    const res = validateLabelPrintConfig({ max_labels_per_print: badMax });
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.some((e) => e.code === 'INVALID_MAX_LABELS_PER_PRINT')
    );
  }

  // Reject non-boolean flags
  const badBool = validateLabelPrintConfig({
    show_price: 'no',
  });
  assert.equal(badBool.valid, false);
  assert.ok(badBool.errors.some((e) => e.code === 'INVALID_BOOLEAN_FLAG'));

  // Reject forbidden fields (e.g. non-existent customer_name or payment_status mutation)
  const forbiddenFieldRes = validateLabelPrintConfig({
    show_customer_name: true,
    payment_status: 'paid',
  });
  assert.equal(forbiddenFieldRes.valid, false);
  assert.ok(
    forbiddenFieldRes.errors.some(
      (e) =>
        e.code === 'FORBIDDEN_LABEL_CONFIG_FIELD' &&
        e.field === 'show_customer_name'
    )
  );
  assert.ok(
    forbiddenFieldRes.errors.some(
      (e) =>
        e.code === 'FORBIDDEN_LABEL_CONFIG_FIELD' &&
        e.field === 'payment_status'
    )
  );

  // Reject unsafe or overlong custom_footer_i18n
  const unsafeFooter = validateLabelPrintConfig({
    custom_footer_i18n: { vi: '<img src=x onerror=alert(1)>' },
  });
  assert.equal(unsafeFooter.valid, false);
  assert.ok(unsafeFooter.errors.some((e) => e.code === 'UNSAFE_CUSTOM_FOOTER'));

  const longFooter = validateLabelPrintConfig({
    custom_footer_i18n: { vi: 'A'.repeat(121) },
  });
  assert.equal(longFooter.valid, false);
  assert.ok(
    longFooter.errors.some((e) => e.code === 'CUSTOM_FOOTER_TOO_LONG')
  );

  // resolveShopLabelPrintConfig falls back safely when theme_config has no labelPrintConfig
  assert.deepEqual(
    resolveShopLabelPrintConfig(null),
    DEFAULT_SHOP_LABEL_PRINT_CONFIG
  );
});

test('Slice 2: PATCH /api/shops enforces owner/Super Admin auth and server-side validation for orderWorkflow and labelPrintConfig while preserving unrelated theme_config keys', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const ownerId = '00000000-0000-0000-0000-000000000101';
  const staffId = '00000000-0000-0000-0000-000000000102';
  const cashierId = '00000000-0000-0000-0000-000000000103';
  const adminId = '00000000-0000-0000-0000-000000000199';

  class PgQueryBuilder {
    private table: string;
    private columns = '*';
    private eqFilters: Array<[string, unknown]> = [];
    private neqFilters: Array<[string, unknown]> = [];
    private singleMode: 'none' | 'maybe' | 'single' = 'none';
    private updatePayload: Record<string, unknown> | null = null;
    private insertPayload: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }
    select(columns = '*') {
      this.columns = columns;
      return this;
    }
    eq(column: string, value: unknown) {
      this.eqFilters.push([column, value]);
      return this;
    }
    neq(column: string, value: unknown) {
      this.neqFilters.push([column, value]);
      return this;
    }
    order() {
      return this;
    }
    maybeSingle() {
      this.singleMode = 'maybe';
      return this;
    }
    single() {
      this.singleMode = 'single';
      return this;
    }
    insert(payload: Record<string, unknown>) {
      this.insertPayload = payload;
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }
    async execute() {
      const ident = (value: string) => {
        assert.match(value, /^[a-z_]+$/i);
        return `"${value}"`;
      };
      const params: unknown[] = [];
      const buildWhere = () => {
        const clauses: string[] = [];
        for (const [col, val] of this.eqFilters) {
          params.push(val);
          clauses.push(`${ident(col)} = $${params.length}`);
        }
        for (const [col, val] of this.neqFilters) {
          params.push(val);
          clauses.push(`${ident(col)} <> $${params.length}`);
        }
        return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      };
      try {
        if (this.insertPayload) {
          const keys = Object.keys(this.insertPayload);
          const cols = keys.map(ident).join(', ');
          const vals = keys.map((k) => {
            const v = this.insertPayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `$${params.length}`;
          });
          const { rows } = await db.query(
            `INSERT INTO ${ident(this.table)} (${cols}) VALUES (${vals.join(', ')}) RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        if (this.updatePayload) {
          const keys = Object.keys(this.updatePayload);
          const setClauses = keys.map((k) => {
            const v = this.updatePayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `${ident(k)} = $${params.length}`;
          });
          const whereSql = buildWhere();
          const { rows } = await db.query(
            `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        const selectCols =
          this.columns === '*'
            ? '*'
            : this.columns
                .split(',')
                .map((c) => ident(c.trim()))
                .join(', ');
        const whereSql = buildWhere();
        const { rows } = await db.query(
          `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    then(
      resolve: (result: unknown) => unknown,
      reject: (err: unknown) => unknown
    ) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    from: (table: string) => new PgQueryBuilder(table),
  };

  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await db.exec(
        fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
      );
    }
    await db.exec(`
      INSERT INTO profiles (id) VALUES
        ('${ownerId}'),
        ('${staffId}'),
        ('${cashierId}'),
        ('${adminId}');
      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES (
        'wf-shop-1',
        '${ownerId}',
        'wf-shop-1',
        'Quán Trà Sữa WF',
        true,
        '{"primaryColor":"#1d4ed8","layout":"grid","fontStyle":"modern","paymentQr":{"bankId":"VCB","accountNo":"123456","accountName":"NGUYEN VAN A"},"promoBanner":{"enabled":true,"discountValue":10,"title":"Giảm 10%"}}'::jsonb
      );
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-wf-staff', 'wf-shop-1', '${staffId}', 'staff', '["orders.view","orders.fulfill","settings.manage"]'::jsonb, true),
        ('mem-wf-cashier', 'wf-shop-1', '${cashierId}', 'cashier', '["orders.view","orders.create","orders.fulfill","payment.collect","settings.manage"]'::jsonb, true);
    `);

    setSupabaseDbClientForTests(client);
    setShopMembershipDbClientForTest(client as never);

    const ownerToken = issueSessionToken({
      id: ownerId,
      email: 'owner@qlaok.test',
      role: 'owner',
    });
    const staffToken = issueSessionToken({
      id: staffId,
      email: 'staff@qlaok.test',
      role: 'staff',
    });
    const cashierToken = issueSessionToken({
      id: cashierId,
      email: 'cashier@qlaok.test',
      role: 'cashier',
    });
    const adminToken = issueSessionToken({
      id: adminId,
      email: 'hoangvu96z@gmail.com',
      role: 'admin',
      is_admin: true,
    });

    const counterBarTemplate =
      getBuiltInOrderWorkflowTemplate('counter_bar_serve');

    // 1. Staff and cashier (even with settings.manage) are forbidden (403) from changing orderWorkflow or labelPrintConfig
    for (const token of [staffToken, cashierToken]) {
      const forbidWfRes = await patchShops(
        new Request('http://localhost/api/shops', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: 'wf-shop-1',
            theme_config: { orderWorkflow: counterBarTemplate },
          }),
        })
      );
      assert.equal(forbidWfRes.status, 403);

      const forbidLabelRes = await patchShops(
        new Request('http://localhost/api/shops', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: 'wf-shop-1',
            theme_config: {
              labelPrintConfig: {
                ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
                paper_preset: 'production_slip_58mm',
              },
            },
          }),
        })
      );
      assert.equal(forbidLabelRes.status, 403);
    }

    // 2. Owner saving invalid orderWorkflow or invalid labelPrintConfig is rejected with 400 (never silently saved as defaults)
    const badWfRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: 'wf-shop-1',
          theme_config: {
            orderWorkflow: {
              template_id: 'custom',
              kds_enabled: true,
              start_step_id: 'step_a',
              steps: [
                {
                  id: 'step_a',
                  stage: 'new',
                  label_i18n: { vi: 'Mới' },
                  show_on_kds: true,
                  next_step_ids: ['step_b'],
                },
                {
                  id: 'step_b',
                  stage: 'preparing',
                  label_i18n: { vi: 'Đang làm' },
                  show_on_kds: true,
                  next_step_ids: ['step_a'], // cycle + no terminal completed step
                },
              ],
            },
          },
        }),
      })
    );
    assert.equal(badWfRes.status, 400);
    const badWfBody = (await badWfRes.json()) as {
      code?: string;
      errors?: unknown[];
    };
    assert.ok(Array.isArray(badWfBody.errors) && badWfBody.errors.length > 0);

    const badLabelRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: 'wf-shop-1',
          theme_config: {
            labelPrintConfig: {
              paper_preset: 'invalid_size',
              copies_per_unit: 99,
            },
          },
        }),
      })
    );
    assert.equal(badLabelRes.status, 400);
    const badLabelBody = (await badLabelRes.json()) as {
      code?: string;
      errors?: unknown[];
    };
    assert.ok(
      Array.isArray(badLabelBody.errors) && badLabelBody.errors.length > 0
    );

    // 3. Owner saves valid counter_bar_serve workflow and custom labelPrintConfig; unrelated theme_config keys are preserved
    const ownerSaveRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: 'wf-shop-1',
          theme_config: {
            orderWorkflow: counterBarTemplate,
            labelPrintConfig: {
              ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
              paper_preset: 'cup_sticker_40x30',
              copies_per_unit: 2,
              custom_footer_i18n: { vi: 'Quầy pha chế Tầng 1', en: 'Bar L1' },
            },
          },
        }),
      })
    );
    assert.equal(ownerSaveRes.status, 200);
    const ownerSaveBody = (await ownerSaveRes.json()) as {
      shop: { theme_config: ShopThemeConfig };
    };
    assert.equal(
      ownerSaveBody.shop.theme_config.orderWorkflow?.template_id,
      'counter_bar_serve'
    );
    assert.equal(
      ownerSaveBody.shop.theme_config.labelPrintConfig?.paper_preset,
      'cup_sticker_40x30'
    );
    assert.equal(
      ownerSaveBody.shop.theme_config.labelPrintConfig?.copies_per_unit,
      2
    );
    assert.equal(ownerSaveBody.shop.theme_config.fontStyle, 'modern');
    assert.equal(ownerSaveBody.shop.theme_config.paymentQr?.bankId, 'VCB');
    assert.equal(ownerSaveBody.shop.theme_config.promoBanner?.discountValue, 10);

    // 4. Staff with settings.manage can still update general settings (e.g. fontStyle) while spreading unchanged theme_config, and workflow/label configs are preserved
    const staffGeneralRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          id: 'wf-shop-1',
          theme_config: {
            ...ownerSaveBody.shop.theme_config,
            fontStyle: 'serif',
          },
        }),
      })
    );
    assert.equal(staffGeneralRes.status, 200);
    const staffGeneralBody = (await staffGeneralRes.json()) as {
      shop: { theme_config: ShopThemeConfig };
    };
    assert.equal(
      staffGeneralBody.shop.theme_config.fontStyle,
      'serif'
    );
    assert.equal(
      staffGeneralBody.shop.theme_config.orderWorkflow?.template_id,
      'counter_bar_serve'
    );
    assert.equal(
      staffGeneralBody.shop.theme_config.labelPrintConfig?.paper_preset,
      'cup_sticker_40x30'
    );

    // 5. Super Admin can also update orderWorkflow
    const simpleCounter = getBuiltInOrderWorkflowTemplate('simple_counter');
    const adminSaveRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          id: 'wf-shop-1',
          theme_config: {
            orderWorkflow: simpleCounter,
          },
        }),
      })
    );
    assert.equal(adminSaveRes.status, 200);
    const adminSaveBody = (await adminSaveRes.json()) as {
      shop: { theme_config: ShopThemeConfig };
    };
    assert.equal(
      adminSaveBody.shop.theme_config.orderWorkflow?.template_id,
      'simple_counter'
    );
    // Label print config was omitted in partial theme_config patch and must be preserved
    assert.equal(
      adminSaveBody.shop.theme_config.labelPrintConfig?.paper_preset,
      'cup_sticker_40x30'
    );
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    await db.close();
  }
});

test('Slice 2: order create/update/print APIs and PostgreSQL RPCs persist workflow_step_id and label_printed_count, enforce graph transitions, and keep payment independent', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const ownerId = '00000000-0000-0000-0000-000000000201';
  const fulfillStaffId = '00000000-0000-0000-0000-000000000202';
  const cashierId = '00000000-0000-0000-0000-000000000203';
  const viewOnlyStaffId = '00000000-0000-0000-0000-000000000204';
  let simulateRpcFailure = false;

  class PgQueryBuilder {
    private table: string;
    private columns = '*';
    private eqFilters: Array<[string, unknown]> = [];
    private singleMode: 'none' | 'maybe' | 'single' = 'none';
    private updatePayload: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }
    select(columns = '*') {
      this.columns = columns;
      return this;
    }
    eq(column: string, value: unknown) {
      this.eqFilters.push([column, value]);
      return this;
    }
    order() {
      return this;
    }
    maybeSingle() {
      this.singleMode = 'maybe';
      return this;
    }
    single() {
      this.singleMode = 'single';
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }
    async execute() {
      const ident = (value: string) => {
        assert.match(value, /^[a-z_]+$/i);
        return `"${value}"`;
      };
      const params: unknown[] = [];
      const clauses = this.eqFilters.map(([col, val]) => {
        params.push(val);
        return `${ident(col)} = $${params.length}`;
      });
      const whereSql =
        clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      try {
        if (this.updatePayload) {
          const keys = Object.keys(this.updatePayload);
          const setClauses = keys.map((k) => {
            const v = this.updatePayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `${ident(k)} = $${params.length}`;
          });
          const { rows } = await db.query(
            `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        const selectCols =
          this.columns === '*'
            ? '*'
            : this.columns
                .split(',')
                .map((c) => ident(c.trim()))
                .join(', ');
        const { rows } = await db.query(
          `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    then(
      resolve: (result: unknown) => unknown,
      reject: (err: unknown) => unknown
    ) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    from: (table: string) => new PgQueryBuilder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (simulateRpcFailure) {
        return {
          data: null,
          error: { message: 'SIMULATED_PG_RPC_FAILURE' },
        };
      }
      const names = Object.keys(args);
      assert.match(name, /^[a-z_]+$/);
      const parameters = names
        .map((key, i) => {
          assert.match(key, /^[a-z_]+$/);
          return `${key} => $${i + 1}`;
        })
        .join(', ');
      try {
        const { rows } = await db.query<{ result: unknown }>(
          `SELECT ${name}(${parameters}) AS result`,
          names.map((key) =>
            typeof args[key] === 'object' && args[key] !== null
              ? JSON.stringify(args[key])
              : args[key]
          )
        );
        return { data: rows[0]?.result ?? null, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };

  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await db.exec(
        fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
      );
    }

    const counterBarConfig =
      getBuiltInOrderWorkflowTemplate('counter_bar_serve');

    await db.exec(`
      INSERT INTO profiles (id) VALUES
        ('${ownerId}'),
        ('${fulfillStaffId}'),
        ('${cashierId}'),
        ('${viewOnlyStaffId}');
      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES (
        'wf-order-shop',
        '${ownerId}',
        'wf-order-shop',
        'Quán Pha Chế Gần Quầy',
        true,
        '${JSON.stringify({ orderWorkflow: counterBarConfig })}'::jsonb
      );
      INSERT INTO categories (id, shop_id, name_i18n) VALUES (
        'wf-cat-1',
        'wf-order-shop',
        '{"vi":"Đồ uống"}'::jsonb
      );
      INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, is_available) VALUES (
        'wf-item-1',
        'wf-order-shop',
        'wf-cat-1',
        '{"vi":"Trà Đào Cam Sả","en":"Peach Lemongrass Tea"}'::jsonb,
        45000,
        50,
        true
      );
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-fulfill', 'wf-order-shop', '${fulfillStaffId}', 'staff', '["orders.view","orders.create","orders.fulfill","orders.print_kitchen","orders.cancel_unpaid"]'::jsonb, true),
        ('mem-cashier', 'wf-order-shop', '${cashierId}', 'cashier', '["orders.view","orders.create","orders.fulfill","orders.edit_items","payment.collect","orders.print_kitchen","orders.print_provisional"]'::jsonb, true),
        ('mem-view-only', 'wf-order-shop', '${viewOnlyStaffId}', 'staff', '["orders.view"]'::jsonb, true);
    `);

    setSupabaseDbClientForTests(client);
    setMposDbClientForTests(client, true);
    setShopMembershipDbClientForTest(client as never);
    setShopTablesDbClientForTests(client, true);

    const fulfillToken = issueSessionToken({
      id: fulfillStaffId,
      email: 'fulfill@qlaok.test',
      role: 'staff',
    });
    const cashierToken = issueSessionToken({
      id: cashierId,
      email: 'cashier@qlaok.test',
      role: 'cashier',
    });
    const viewOnlyToken = issueSessionToken({
      id: viewOnlyStaffId,
      email: 'view@qlaok.test',
      role: 'staff',
    });

    // 1. Create a new order -> initializes workflow_step_id to configured start step ('counter_received') and label_printed_count = 0
    const createRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          shop_id: 'wf-order-shop',
          table_label: 'Tại quầy',
          source: 'counter_pos',
          payment_method: 'cash',
          payment_status: 'unpaid',
          items: [
            {
              item_id: 'wf-item-1',
              name_vi: 'Trà Đào Cam Sả',
              quantity: 2,
              unit_price: 45000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(createRes.status, 201);
    const createdPayload = (await createRes.json()) as {
      order: ShopOrder;
      trackingToken?: string;
    };
    const createdOrder = createdPayload.order;
    assert.equal(createdOrder.status, 'new');
    assert.equal(createdOrder.workflow_step_id, 'counter_received');
    assert.equal(createdOrder.payment_status, 'unpaid');
    assert.equal(createdOrder.label_printed_count, 0);

    const dbRowAfterCreate = (
      await db.query<{
        status: string;
        workflow_step_id: string | null;
        payment_status: string;
        label_printed_count: number;
      }>(
        "SELECT status, workflow_step_id, payment_status, label_printed_count FROM orders WHERE id = $1",
        [createdOrder.id]
      )
    ).rows[0];
    assert.equal(dbRowAfterCreate.status, 'new');
    assert.equal(dbRowAfterCreate.workflow_step_id, 'counter_received');
    assert.equal(dbRowAfterCreate.payment_status, 'unpaid');
    assert.equal(dbRowAfterCreate.label_printed_count, 0);

    // 2. Customer trackingToken cannot pass workflow_step_id (403 CUSTOMER_ACTION_FORBIDDEN)
    assert.ok(createdOrder.tracking_token);
    const guestWfAttempt = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: createdOrder.id,
          trackingToken: createdOrder.tracking_token,
          workflow_step_id: 'bar_making',
        }),
      })
    );
    assert.equal(guestWfAttempt.status, 403);

    // 3. View-only staff without orders.fulfill cannot transition workflow step (403)
    const viewOnlyAttempt = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewOnlyToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          workflow_step_id: 'bar_making',
        }),
      })
    );
    assert.equal(viewOnlyAttempt.status, 403);

    // 4. Attempting to skip 'bar_making' directly to 'served' from 'counter_received' is rejected (400 INVALID_WORKFLOW_TRANSITION)
    const skipStepRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          workflow_step_id: 'served',
        }),
      })
    );
    assert.equal(skipStepRes.status, 400);
    const skipStepBody = (await skipStepRes.json()) as { code?: string };
    assert.equal(skipStepBody.code, 'INVALID_WORKFLOW_TRANSITION');

    // Legacy caller sending status: 'completed' when 'bar_making' is required is also rejected
    const legacySkipRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          status: 'completed',
        }),
      })
    );
    assert.equal(legacySkipRes.status, 400);
    const legacySkipBody = (await legacySkipRes.json()) as { code?: string };
    assert.equal(legacySkipBody.code, 'INVALID_WORKFLOW_TRANSITION');

    // Sending mismatched status + workflow_step_id is rejected (400 WORKFLOW_STAGE_MISMATCH)
    const mismatchRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          status: 'completed',
          workflow_step_id: 'bar_making',
        }),
      })
    );
    assert.equal(mismatchRes.status, 400);
    const mismatchBody = (await mismatchRes.json()) as { code?: string };
    assert.equal(mismatchBody.code, 'WORKFLOW_STAGE_MISMATCH');

    // 5. Valid transition: counter_received -> bar_making via explicit workflow_step_id
    const toBarRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          workflow_step_id: 'bar_making',
        }),
      })
    );
    assert.equal(toBarRes.status, 200);
    const toBarOrder = ((await toBarRes.json()) as { order: ShopOrder }).order;
    assert.equal(toBarOrder.status, 'preparing');
    assert.equal(toBarOrder.workflow_step_id, 'bar_making');
    assert.equal(toBarOrder.payment_status, 'unpaid');
    assert.equal(toBarOrder.total_amount, 90000);

    // Customer pre-acceptance self-edit is now locked (409 ORDER_ALREADY_ACCEPTED) because order left stage 'new'
    const lockedCustomerEdit = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: createdOrder.id,
          trackingToken: createdOrder.tracking_token,
          customer_note: 'Đổi ý sau khi quầy đã pha',
        }),
      })
    );
    assert.equal(lockedCustomerEdit.status, 409);

    // 6. Record label print ('label') -> increments label_printed_count and print_count only
    const viewOnlyLabelPrint = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewOnlyToken}`,
        },
        body: JSON.stringify({
          action: 'record_print',
          orderId: createdOrder.id,
          ticketType: 'label',
        }),
      })
    );
    assert.equal(
      viewOnlyLabelPrint.status,
      403,
      'label printing requires orders.print_kitchen permission'
    );

    const labelPrint1Res = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          action: 'record_print',
          orderId: createdOrder.id,
          ticketType: 'label',
        }),
      })
    );
    assert.equal(labelPrint1Res.status, 200);
    const labelPrint1Body = (await labelPrint1Res.json()) as {
      order: ShopOrder;
      ticketType: string;
      printCount: number;
      isReprint: boolean;
    };
    assert.equal(labelPrint1Body.ticketType, 'label');
    assert.equal(labelPrint1Body.printCount, 1);
    assert.equal(labelPrint1Body.isReprint, false);
    assert.equal(labelPrint1Body.order.label_printed_count, 1);
    assert.equal(labelPrint1Body.order.print_count, 1);
    assert.equal(labelPrint1Body.order.kitchen_printed_count, 0);
    assert.equal(labelPrint1Body.order.provisional_printed_count, 0);
    assert.equal(labelPrint1Body.order.receipt_printed_count, 0);

    // Second label print is marked as reprint; unpaid receipt print is still blocked (409)
    const labelPrint2Res = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          action: 'record_print',
          orderId: createdOrder.id,
          ticket_type: 'label',
        }),
      })
    );
    assert.equal(labelPrint2Res.status, 200);
    const labelPrint2Body = (await labelPrint2Res.json()) as {
      order: ShopOrder;
      printCount: number;
      isReprint: boolean;
    };
    assert.equal(labelPrint2Body.printCount, 2);
    assert.equal(labelPrint2Body.isReprint, true);
    assert.equal(labelPrint2Body.order.label_printed_count, 2);
    assert.equal(labelPrint2Body.order.print_count, 2);

    const unpaidReceiptPrint = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          action: 'record_print',
          orderId: createdOrder.id,
          ticketType: 'receipt',
        }),
      })
    );
    assert.equal(unpaidReceiptPrint.status, 409);

    // 7. Complete fulfillment (bar_making -> served) by fulfillStaff (no payment.collect permission); order remains unpaid!
    const toServedRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          workflow_step_id: 'served',
        }),
      })
    );
    assert.equal(toServedRes.status, 200);
    const servedOrder = ((await toServedRes.json()) as { order: ShopOrder })
      .order;
    assert.equal(servedOrder.status, 'completed');
    assert.equal(servedOrder.workflow_step_id, 'served');
    assert.equal(
      servedOrder.payment_status,
      'unpaid',
      'completing service must never mark an order paid'
    );
    assert.equal(servedOrder.label_printed_count, 2);

    // 8. Collect payment independently via cashier -> preserves workflow_step_id = 'served' and status = 'completed'
    const collectRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          payment_status: 'paid',
          payment_method: 'cash',
          expected_total: 90000,
        }),
      })
    );
    assert.equal(collectRes.status, 200);
    const paidOrder = ((await collectRes.json()) as { order: ShopOrder }).order;
    assert.equal(paidOrder.payment_status, 'paid');
    assert.equal(paidOrder.status, 'completed');
    assert.equal(paidOrder.workflow_step_id, 'served');
    assert.equal(paidOrder.label_printed_count, 2);

    // 9. Counter POS order with markCompletedImmediately keeps fulfillment independent from payment:
    // 9a. Staff without payment.collect can markCompletedImmediately (completed + unpaid) via POST /api/orders
    const staffImmediateUnpaidRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          shop_id: 'wf-order-shop',
          table_label: 'Mang về (Chưa thu tiền)',
          source: 'counter_pos',
          markCompletedImmediately: true,
          payment_method: 'cash',
          items: [
            {
              item_id: 'wf-item-1',
              name_vi: 'Trà Đào Cam Sả',
              quantity: 1,
              unit_price: 45000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(staffImmediateUnpaidRes.status, 201);
    const staffImmediateUnpaidOrder = (
      (await staffImmediateUnpaidRes.json()) as { order: ShopOrder }
    ).order;
    assert.equal(staffImmediateUnpaidOrder.status, 'completed');
    assert.equal(staffImmediateUnpaidOrder.workflow_step_id, 'served');
    assert.equal(
      staffImmediateUnpaidOrder.payment_status,
      'unpaid',
      'markCompletedImmediately without explicit payment_status=paid must remain unpaid'
    );
    assert.equal(staffImmediateUnpaidOrder.paid_at ?? null, null);
    assert.equal(staffImmediateUnpaidOrder.paid_by ?? null, null);

    // 9b. Staff without payment.collect requesting explicit payment_status='paid' is rejected with 403 even if spoofing caller permission flags
    const staffImmediateSpoofPaidRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          shop_id: 'wf-order-shop',
          table_label: 'Mang về (Spoof Paid)',
          source: 'counter_pos',
          markCompletedImmediately: true,
          payment_status: 'paid',
          canCollectPayment: true,
          isStaffAuthorized: true,
          payment_method: 'cash',
          items: [
            {
              item_id: 'wf-item-1',
              name_vi: 'Trà Đào Cam Sả',
              quantity: 1,
              unit_price: 45000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(staffImmediateSpoofPaidRes.status, 403);
    const spoofPaidBody = (await staffImmediateSpoofPaidRes.json()) as {
      code?: string;
    };
    assert.equal(spoofPaidBody.code, 'INSUFFICIENT_SHOP_PERMISSION');

    // 9c. Cashier WITH payment.collect calling POST /api/orders with markCompletedImmediately=true (without payment_status='paid') also leaves payment_status='unpaid'
    const cashierImmediateUnpaidRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          shop_id: 'wf-order-shop',
          table_label: 'Mang về (Thu ngân hoàn tất phục vụ trước)',
          source: 'counter_pos',
          markCompletedImmediately: true,
          payment_method: 'cash',
          items: [
            {
              item_id: 'wf-item-1',
              name_vi: 'Trà Đào Cam Sả',
              quantity: 1,
              unit_price: 45000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(cashierImmediateUnpaidRes.status, 201);
    const cashierImmediateUnpaidOrder = (
      (await cashierImmediateUnpaidRes.json()) as { order: ShopOrder }
    ).order;
    assert.equal(cashierImmediateUnpaidOrder.status, 'completed');
    assert.equal(cashierImmediateUnpaidOrder.workflow_step_id, 'served');
    assert.equal(cashierImmediateUnpaidOrder.payment_status, 'unpaid');

    // 9d. Cashier WITH payment.collect calling POST /api/orders with markCompletedImmediately=true AND explicit payment_status='paid' marks order completed AND paid
    const cashierImmediatePaidRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          shop_id: 'wf-order-shop',
          table_label: 'Mang về (Thu ngân đã thu tiền)',
          source: 'counter_pos',
          markCompletedImmediately: true,
          payment_status: 'paid',
          payment_method: 'cash',
          items: [
            {
              item_id: 'wf-item-1',
              name_vi: 'Trà Đào Cam Sả',
              quantity: 1,
              unit_price: 45000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(cashierImmediatePaidRes.status, 201);
    const cashierImmediatePaidOrder = (
      (await cashierImmediatePaidRes.json()) as { order: ShopOrder }
    ).order;
    assert.equal(cashierImmediatePaidOrder.status, 'completed');
    assert.equal(cashierImmediatePaidOrder.workflow_step_id, 'served');
    assert.equal(cashierImmediatePaidOrder.payment_status, 'paid');

    // 9e. Service-level dbCreateOrder: markCompletedImmediately alone leaves payment_status='unpaid', and payment_status='paid' without canCollectPayment stays 'unpaid'
    const serviceCompletedUnpaid = await dbCreateOrder({
      shop_id: 'wf-order-shop',
      table_label: 'Mang về Service 1',
      source: 'counter_pos',
      isStaffAuthorized: true,
      markCompletedImmediately: true,
      canCollectPayment: true,
      payment_method: 'cash',
      items: [
        {
          item_id: 'wf-item-1',
          name_vi: 'Trà Đào Cam Sả',
          quantity: 1,
          unit_price: 45000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(serviceCompletedUnpaid.status, 'completed');
    assert.equal(serviceCompletedUnpaid.workflow_step_id, 'served');
    assert.equal(serviceCompletedUnpaid.payment_status, 'unpaid');

    const servicePaidWithoutPerm = await dbCreateOrder({
      shop_id: 'wf-order-shop',
      table_label: 'Mang về Service 2',
      source: 'counter_pos',
      isStaffAuthorized: true,
      markCompletedImmediately: true,
      canCollectPayment: false,
      payment_status: 'paid',
      payment_method: 'cash',
      items: [
        {
          item_id: 'wf-item-1',
          name_vi: 'Trà Đào Cam Sả',
          quantity: 1,
          unit_price: 45000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(servicePaidWithoutPerm.status, 'completed');
    assert.equal(servicePaidWithoutPerm.workflow_step_id, 'served');
    assert.equal(servicePaidWithoutPerm.payment_status, 'unpaid');

    // 10. Branching custom workflow: legacy status-only caller gets 409 AMBIGUOUS_WORKFLOW_TRANSITION when 2 next steps share stage 'preparing'
    const branchingWorkflow = validateOrderWorkflowConfig({
      template_id: 'custom',
      name_i18n: { vi: 'Nhánh Bếp Nóng & Quầy Lạnh' },
      kds_enabled: true,
      start_step_id: 'intake',
      steps: [
        {
          id: 'intake',
          stage: 'new',
          label_i18n: { vi: 'Nhận đơn' },
          show_on_kds: false,
          next_step_ids: ['hot_kitchen', 'cold_bar'],
        },
        {
          id: 'hot_kitchen',
          stage: 'preparing',
          label_i18n: { vi: 'Bếp nóng' },
          show_on_kds: true,
          next_step_ids: ['served_done'],
        },
        {
          id: 'cold_bar',
          stage: 'preparing',
          label_i18n: { vi: 'Quầy pha chế' },
          show_on_kds: false,
          next_step_ids: ['served_done'],
        },
        {
          id: 'served_done',
          stage: 'completed',
          label_i18n: { vi: 'Đã phục vụ' },
          show_on_kds: false,
          next_step_ids: [],
        },
      ],
    }).config;
    assert.ok(branchingWorkflow);
    await db.query(
      "UPDATE shops SET theme_config = $1::jsonb WHERE id = 'wf-order-shop'",
      [JSON.stringify({ orderWorkflow: branchingWorkflow })]
    );

    const branchOrder = await dbCreateOrder({
      shop_id: 'wf-order-shop',
      table_label: 'Bàn 05',
      items: [
        {
          item_id: 'wf-item-1',
          name_vi: 'Trà Đào Cam Sả',
          quantity: 1,
          unit_price: 45000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(branchOrder.workflow_step_id, 'intake');

    const ambiguousRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: branchOrder.id,
          status: 'preparing',
        }),
      })
    );
    assert.equal(ambiguousRes.status, 409);
    const ambiguousBody = (await ambiguousRes.json()) as { code?: string };
    assert.equal(ambiguousBody.code, 'AMBIGUOUS_WORKFLOW_TRANSITION');

    // Selecting an explicit branch ('cold_bar') succeeds, and legacy status='completed' from 'cold_bar' maps to the unique next step ('served_done')
    const chooseBranchRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: branchOrder.id,
          workflow_step_id: 'cold_bar',
        }),
      })
    );
    assert.equal(chooseBranchRes.status, 200);
    const chosenBranchOrder = (
      (await chooseBranchRes.json()) as { order: ShopOrder }
    ).order;
    assert.equal(chosenBranchOrder.status, 'preparing');
    assert.equal(chosenBranchOrder.workflow_step_id, 'cold_bar');

    const legacyCompleteFromColdBar = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          orderId: branchOrder.id,
          status: 'completed',
        }),
      })
    );
    assert.equal(legacyCompleteFromColdBar.status, 200);
    const completedBranchOrder = (
      (await legacyCompleteFromColdBar.json()) as { order: ShopOrder }
    ).order;
    assert.equal(completedBranchOrder.status, 'completed');
    assert.equal(completedBranchOrder.workflow_step_id, 'served_done');

    // 11. Fail-closed DB error handling: simulated RPC failure returns 503 and never mutates DB or returns fake success
    simulateRpcFailure = true;
    const failedPrintRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fulfillToken}`,
        },
        body: JSON.stringify({
          action: 'record_print',
          orderId: createdOrder.id,
          ticketType: 'label',
        }),
      })
    );
    assert.ok(failedPrintRes.status >= 400);
    const failedStepRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          orderId: createdOrder.id,
          customer_note: 'Should fail closed',
        }),
      })
    );
    assert.equal(failedStepRes.status, 503);
    simulateRpcFailure = false;

    const afterFailedRow = await dbGetOrderById(createdOrder.id);
    assert.equal(afterFailedRow?.label_printed_count, 2);
    assert.equal(afterFailedRow?.customer_note, '');
  } finally {
    setSupabaseDbClientForTests(null);
    setMposDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setShopTablesDbClientForTests(null);
    await db.close();
  }
});

// ============================================================================
// SLICE 3: MERCHANT ORDER-WORKFLOW EDITOR UI & CONTROLLER REGRESSION TESTS
// ============================================================================

test('Slice 3: ShopOrderWorkflowEditor template selection, add/remove/connect editing, pre-save validation, PATCH /api/shops payload shape, and SSR markup', async () => {
  await import('./tsx-review-loader.mjs');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const {
    ShopOrderWorkflowEditor,
    WORKFLOW_TEMPLATE_OPTIONS,
    canActorEditOrderWorkflow,
    applyWorkflowTemplateSelection,
    setWorkflowKdsEnabled,
    setWorkflowStartStep,
    addWorkflowStep,
    canRemoveWorkflowStep,
    removeWorkflowStep,
    updateWorkflowStep,
    getEligibleNextStepTargets,
    toggleWorkflowStepConnection,
    formatWorkflowValidationError,
    buildOrderWorkflowPatchPayload,
    saveShopOrderWorkflowConfig,
  } = await import('@/components/dashboard/ShopOrderWorkflowEditor');

  // 1. Built-in template selection loads exact server defaults; custom mode preserves steps and sets template_id='custom'
  assert.equal(WORKFLOW_TEMPLATE_OPTIONS.length, 4);
  for (const tplId of [
    'classic_kitchen',
    'counter_bar_serve',
    'simple_counter',
  ] as const) {
    const selected = applyWorkflowTemplateSelection(
      DEFAULT_SHOP_ORDER_WORKFLOW_CONFIG,
      tplId
    );
    assert.deepEqual(selected, BUILT_IN_ORDER_WORKFLOW_TEMPLATES[tplId]);
    assert.equal(validateOrderWorkflowConfig(selected).valid, true);
  }

  const counterBar = applyWorkflowTemplateSelection(
    DEFAULT_SHOP_ORDER_WORKFLOW_CONFIG,
    'counter_bar_serve'
  );
  const switchedToCustom = applyWorkflowTemplateSelection(counterBar, 'custom');
  assert.equal(switchedToCustom.template_id, 'custom');
  assert.deepEqual(switchedToCustom.steps, counterBar.steps);

  // 2. KDS toggle and start-step selection preserve single-'new'-step invariant and valid DAG edges
  const kdsToggled = setWorkflowKdsEnabled(counterBar, true);
  assert.equal(kdsToggled.kds_enabled, true);
  assert.equal(kdsToggled.template_id, 'custom');

  const startChanged = setWorkflowStartStep(counterBar, 'counter_received');
  assert.equal(startChanged.start_step_id, 'counter_received');
  assert.equal(
    startChanged.steps.filter((s) => s.stage === 'new').length,
    1
  );

  // Switching start_step_id to another preparing step ('bar_making') rewires edges so the workflow stays valid and never regresses or orphans steps
  const switchedStartToPrep = setWorkflowStartStep(counterBar, 'bar_making');
  assert.equal(switchedStartToPrep.start_step_id, 'bar_making');
  assert.equal(switchedStartToPrep.template_id, 'custom');
  assert.equal(
    switchedStartToPrep.steps.filter((s) => s.stage === 'new').length,
    1
  );
  assert.equal(switchedStartToPrep.steps[0].id, 'bar_making');
  assert.equal(switchedStartToPrep.steps[0].stage, 'new');
  const switchedStartValidation =
    validateOrderWorkflowConfig(switchedStartToPrep);
  assert.equal(
    switchedStartValidation.valid,
    true,
    `Switching start step to preparing step must produce a valid DAG: ${JSON.stringify(switchedStartValidation.errors)}`
  );
  assert.equal(
    resolveShopOrderWorkflowConfig(switchedStartToPrep).start_step_id,
    'bar_making'
  );

  // Attempting to set a terminal completed step ('served') as start_step_id is ignored so terminal step is not corrupted
  const ignoredCompletedStart = setWorkflowStartStep(counterBar, 'served');
  assert.equal(ignoredCompletedStart.start_step_id, 'counter_received');
  assert.equal(validateOrderWorkflowConfig(ignoredCompletedStart).valid, true);

  // 3. Adding steps within limits (2..8), keeping stable IDs, editing VI/EN labels & flags, and connecting steps
  let draft = applyWorkflowTemplateSelection(
    DEFAULT_SHOP_ORDER_WORKFLOW_CONFIG,
    'simple_counter'
  );
  assert.equal(draft.steps.length, 2);

  // Cannot remove when already at minimum 2 steps
  assert.equal(canRemoveWorkflowStep(draft, 'completed').allowed, false);
  assert.equal(removeWorkflowStep(draft, 'completed').removed, false);

  // Add a preparing step -> wired between 'new' and 'completed' and immediately valid
  draft = addWorkflowStep(draft, {
    stage: 'preparing',
    labelVi: 'Pha chế trà',
    labelEn: 'Brewing tea',
    actionLabelVi: 'Bắt đầu pha',
    actionLabelEn: 'Start brewing',
    customerLabelVi: 'Quầy đang pha trà',
    customerLabelEn: 'Bar is brewing your tea',
    show_on_kds: false,
    suggest_label_print: true,
  });
  assert.equal(draft.steps.length, 3);
  const addedPrep = draft.steps.find((s) => s.id === 'prep_step_1');
  assert.ok(addedPrep, 'generated stable step id prep_step_1');
  assert.equal(addedPrep.stage, 'preparing');
  assert.equal(addedPrep.suggest_label_print, true);
  assert.deepEqual(addedPrep.next_step_ids, ['completed']);
  assert.deepEqual(
    draft.steps.find((s) => s.id === 'new')?.next_step_ids,
    ['prep_step_1']
  );
  assert.equal(validateOrderWorkflowConfig(draft).valid, true);

  // Edit step labels and flags -> step.id remains 'prep_step_1' and references stay intact
  draft = updateWorkflowStep(draft, 'prep_step_1', {
    labelVi: 'Quầy pha chế đóng nắp',
    labelEn: 'Bar sealing cup',
    actionLabelVi: 'Đóng nắp xong',
    actionLabelEn: 'Cup sealed',
    customerLabelVi: 'Đang đóng nắp ly',
    customerLabelEn: 'Sealing your cup',
    show_on_kds: true,
    suggest_label_print: false,
  });
  const editedPrep = draft.steps.find((s) => s.id === 'prep_step_1')!;
  assert.equal(editedPrep.id, 'prep_step_1');
  assert.equal(editedPrep.label_i18n.vi, 'Quầy pha chế đóng nắp');
  assert.equal(editedPrep.label_i18n.en, 'Bar sealing cup');
  assert.equal(editedPrep.action_label_i18n.vi, 'Đóng nắp xong');
  assert.equal(editedPrep.action_label_i18n.en, 'Cup sealed');
  assert.equal(editedPrep.customer_label_i18n?.vi, 'Đang đóng nắp ly');
  assert.equal(editedPrep.customer_label_i18n?.en, 'Sealing your cup');
  assert.equal(editedPrep.show_on_kds, true);
  assert.equal(editedPrep.suggest_label_print, false);
  assert.equal(validateOrderWorkflowConfig(draft).valid, true);

  // Add steps up to MAX_WORKFLOW_STEPS (8) and verify cap at 8
  let maxDraft = draft;
  for (let i = 0; i < 10; i += 1) {
    maxDraft = addWorkflowStep(maxDraft, { stage: 'preparing' });
  }
  assert.equal(maxDraft.steps.length, 8);
  assert.equal(validateOrderWorkflowConfig(maxDraft).valid, true);

  // 4. Prevent deleting the start step or last completed step, and prevent dangling references when deleting an intermediate step
  assert.equal(canRemoveWorkflowStep(draft, 'new').allowed, false);
  const blockedStartDelete = removeWorkflowStep(draft, 'new');
  assert.equal(blockedStartDelete.removed, false);
  assert.ok(blockedStartDelete.reasonVi?.includes('bắt đầu'));

  assert.equal(canRemoveWorkflowStep(draft, 'completed').allowed, false);

  // Deleting intermediate 'prep_step_1' removes it and bridges 'new' -> 'completed' with zero dangling references
  const removedMid = removeWorkflowStep(draft, 'prep_step_1');
  assert.equal(removedMid.removed, true);
  assert.equal(removedMid.config.steps.length, 2);
  assert.ok(
    !removedMid.config.steps.some((s) =>
      s.next_step_ids.includes('prep_step_1')
    ),
    'no dangling reference to prep_step_1 remains'
  );
  assert.deepEqual(
    removedMid.config.steps.find((s) => s.id === 'new')?.next_step_ids,
    ['completed']
  );
  assert.equal(validateOrderWorkflowConfig(removedMid.config).valid, true);

  // 5. Connection toggling & pre-save validation errors
  const eligibleFromStart = getEligibleNextStepTargets(counterBar, 'counter_received');
  assert.deepEqual(
    eligibleFromStart.map((s) => s.id),
    ['bar_making', 'served']
  );
  assert.deepEqual(getEligibleNextStepTargets(counterBar, 'served'), []);

  // Self-loop toggle is ignored
  const selfLoopIgnored = toggleWorkflowStepConnection(
    counterBar,
    'bar_making',
    'bar_making',
    true
  );
  assert.ok(
    !selfLoopIgnored.steps
      .find((s) => s.id === 'bar_making')
      ?.next_step_ids.includes('bar_making')
  );

  // Disconnecting 'bar_making' from 'served' creates a DEAD_END_STEP caught before save
  const deadEndDraft = toggleWorkflowStepConnection(
    counterBar,
    'bar_making',
    'served',
    false
  );
  const deadEndValidation = validateOrderWorkflowConfig(deadEndDraft);
  assert.equal(deadEndValidation.valid, false);
  const localizedDeadEndVi = formatWorkflowValidationError(
    deadEndValidation.errors[0],
    deadEndDraft,
    'vi'
  );
  const localizedDeadEndEn = formatWorkflowValidationError(
    deadEndValidation.errors[0],
    deadEndDraft,
    'en'
  );
  assert.match(localizedDeadEndVi, /Quầy pha chế đang làm/);
  assert.match(localizedDeadEndEn, /Bar preparing/);

  // Invalid draft blocks saveShopOrderWorkflowConfig before any network call
  let fetchCalledOnInvalid = false;
  const invalidSaveRes = await saveShopOrderWorkflowConfig({
    shopId: 'wf-ui-shop',
    draft: deadEndDraft,
    locale: 'vi',
    fetchImpl: async () => {
      fetchCalledOnInvalid = true;
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(invalidSaveRes.ok, false);
  assert.equal(fetchCalledOnInvalid, false);
  if (!invalidSaveRes.ok) {
    assert.ok((invalidSaveRes.validationErrors?.length ?? 0) > 0);
  }

  // 6. Persistence request shape & surfaced API errors/success against PATCH /api/shops + PGlite
  const db = new PGlite({ extensions: { uuid_ossp } });
  const ownerId = '00000000-0000-4000-8000-000000000501';
  const staffId = '00000000-0000-4000-8000-000000000502';

  function ident(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }
  let simulateShopUpdateDbError = false;
  let simulateShopUpdateNullRow = false;

  class PgQueryBuilder {
    private table: string;
    private filters: Array<{ col: string; val: unknown }> = [];
    private inFilters: Array<{ col: string; vals: unknown[] }> = [];
    private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
    private updatePayload: Record<string, unknown> | null = null;
    private limitCount: number | null = null;
    constructor(table: string) {
      this.table = table;
    }
    select() {
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ col, val });
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.inFilters.push({ col, vals });
      return this;
    }
    order() {
      return this;
    }
    limit(n: number) {
      this.limitCount = n;
      return this;
    }
    single() {
      this.singleMode = 'single';
      return this;
    }
    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this;
    }
    async execute(): Promise<{
      data: unknown;
      error: { message: string } | null;
    }> {
      try {
        const params: unknown[] = [];
        const clauses: string[] = [];
        for (const f of this.filters) {
          params.push(f.val);
          clauses.push(`${ident(f.col)} = $${params.length}`);
        }
        for (const inf of this.inFilters) {
          if (inf.vals.length === 0) {
            clauses.push('1 = 0');
          } else {
            const placeholders = inf.vals.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            clauses.push(`${ident(inf.col)} IN (${placeholders.join(', ')})`);
          }
        }
        const whereSql =
          clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
        if (this.updatePayload) {
          if (simulateShopUpdateDbError && this.table === 'shops') {
            return {
              data: null,
              error: { message: 'SIMULATED_DB_WRITE_FAILURE' },
            };
          }
          if (simulateShopUpdateNullRow && this.table === 'shops') {
            return {
              data: null,
              error: null,
            };
          }
          const keys = Object.keys(this.updatePayload);
          const setClauses = keys.map((k) => {
            const v = this.updatePayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `${ident(k)} = $${params.length}`;
          });
          const { rows } = await db.query(
            `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        const limitSql =
          this.limitCount !== null ? ` LIMIT ${Number(this.limitCount)}` : '';
        const { rows } = await db.query(
          `SELECT * FROM ${ident(this.table)}${whereSql}${limitSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    then(
      resolve: (result: unknown) => unknown,
      reject: (err: unknown) => unknown
    ) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    from: (table: string) => new PgQueryBuilder(table),
  };

  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await db.exec(
        fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
      );
    }
    await db.exec(`
      INSERT INTO profiles (id) VALUES ('${ownerId}'), ('${staffId}');
      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES (
        'wf-ui-shop',
        '${ownerId}',
        'wf-ui-shop',
        'Quán Cafe Flowchart',
        true,
        '{"primaryColor":"#10b981","layout":"grid","paymentQr":{"bankId":"MB","accountNo":"88889999","accountName":"CHU QUAN"},"promoBanner":{"enabled":true,"discountValue":15,"title":"Ưu đãi"}}'::jsonb
      );
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-ui-staff', 'wf-ui-shop', '${staffId}', 'staff', '["orders.view","settings.manage"]'::jsonb, true);
    `);

    setSupabaseDbClientForTests(client);
    setShopMembershipDbClientForTest(client as never);

    const ownerToken = issueSessionToken({
      id: ownerId,
      email: 'owner-ui@qlaok.test',
      role: 'owner',
    });
    const staffToken = issueSessionToken({
      id: staffId,
      email: 'staff-ui@qlaok.test',
      role: 'staff',
    });

    const capturedRequests: Array<{
      url: string;
      method: string;
      body: Record<string, unknown>;
    }> = [];

    const makeRouteFetch =
      (token: string): typeof fetch =>
      async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const rawBody = init?.body ? String(init.body) : '{}';
        capturedRequests.push({
          url,
          method: init?.method || 'GET',
          body: JSON.parse(rawBody) as Record<string, unknown>,
        });
        return patchShops(
          new Request(`http://localhost${url}`, {
            method: init?.method || 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: rawBody,
          })
        );
      };

    // 6a. Non-owner staff attempt fails with 403 and never calls onUpdateActiveShop
    let updatedShopFromStaff: Shop | null = null;
    const staffSaveResult = await saveShopOrderWorkflowConfig({
      shopId: 'wf-ui-shop',
      draft: counterBar,
      locale: 'vi',
      fetchImpl: makeRouteFetch(staffToken),
      onUpdateActiveShop: (s) => {
        updatedShopFromStaff = s;
      },
    });
    assert.equal(staffSaveResult.ok, false);
    assert.equal(updatedShopFromStaff, null);

    // 6b. Owner saves customized workflow -> request payload has ONLY { id, theme_config: { orderWorkflow } }, updates activeShop & refreshes dashboard, and preserves unrelated theme_config keys
    let updatedShopFromOwner: Shop | null = null;
    let dashboardRefreshCount = 0;
    const ownerSaveResult = await saveShopOrderWorkflowConfig({
      shopId: 'wf-ui-shop',
      draft: counterBar,
      locale: 'vi',
      fetchImpl: makeRouteFetch(ownerToken),
      onUpdateActiveShop: (s) => {
        updatedShopFromOwner = s;
      },
      onRefreshDashboard: async () => {
        dashboardRefreshCount += 1;
      },
    });
    assert.equal(ownerSaveResult.ok, true);
    assert.equal(dashboardRefreshCount, 1);
    assert.ok(updatedShopFromOwner);

    const lastReq = capturedRequests[capturedRequests.length - 1];
    assert.equal(lastReq.url, '/api/shops');
    assert.equal(lastReq.method, 'PATCH');
    assert.deepEqual(
      lastReq.body,
      buildOrderWorkflowPatchPayload('wf-ui-shop', counterBar)
    );
    assert.deepEqual(Object.keys(lastReq.body).sort(), ['id', 'theme_config']);
    assert.deepEqual(
      Object.keys(lastReq.body.theme_config as Record<string, unknown>),
      ['orderWorkflow']
    );

    if (ownerSaveResult.ok) {
      assert.equal(
        ownerSaveResult.shop.theme_config.primaryColor,
        '#10b981',
        'unrelated primaryColor preserved'
      );
      assert.equal(
        ownerSaveResult.shop.theme_config.paymentQr?.accountNo,
        '88889999',
        'unrelated paymentQr preserved'
      );
      assert.equal(
        ownerSaveResult.workflow.template_id,
        'counter_bar_serve'
      );
    }

    // 6c. Fresh reload via GET /api/shops?shopId=..., GET /api/shops?ownerId=..., dbGetShopById, and dbGetAllShopsAndProfile resolves to the saved counter_bar_serve workflow (never reverting to classic_kitchen)
    const reloadByShopIdRes = await getShops(
      new Request('http://localhost/api/shops?shopId=wf-ui-shop', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    assert.equal(reloadByShopIdRes.status, 200);
    const reloadedByShopIdPayload = (await reloadByShopIdRes.json()) as {
      shop: Shop;
    };
    assert.deepEqual(
      resolveShopOrderWorkflowConfig(reloadedByShopIdPayload.shop.theme_config),
      counterBar
    );

    const reloadByOwnerIdRes = await getShops(
      new Request(
        `http://localhost/api/shops?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${ownerToken}` },
        }
      )
    );
    assert.equal(reloadByOwnerIdRes.status, 200);
    const reloadedByOwnerIdPayload = (await reloadByOwnerIdRes.json()) as {
      shops: Shop[];
    };
    const reloadedOwnerShop = reloadedByOwnerIdPayload.shops.find(
      (s) => s.id === 'wf-ui-shop'
    );
    assert.ok(reloadedOwnerShop, 'owner reload includes wf-ui-shop');
    assert.deepEqual(
      resolveShopOrderWorkflowConfig(reloadedOwnerShop.theme_config),
      counterBar
    );

    // 6d. Saving a custom workflow with edited rules, added step, and switched start step persists and resolves identically after reload + subsequent unrelated Settings PATCH
    let customRulesDraft = applyWorkflowTemplateSelection(
      counterBar,
      'simple_counter'
    );
    customRulesDraft = setWorkflowKdsEnabled(customRulesDraft, true);
    customRulesDraft = addWorkflowStep(customRulesDraft, {
      id: 'tea_shake',
      stage: 'preparing',
      labelVi: 'Lắc trà & đóng nắp',
      labelEn: 'Shake tea & seal',
      actionLabelVi: 'Lắc trà & in tem',
      actionLabelEn: 'Shake & print label',
      customerLabelVi: 'Quầy đang lắc trà',
      customerLabelEn: 'Shaking your tea',
      show_on_kds: true,
      suggest_label_print: true,
    });
    customRulesDraft = setWorkflowStartStep(customRulesDraft, 'tea_shake');
    assert.equal(validateOrderWorkflowConfig(customRulesDraft).valid, true);

    let reloadedDashboardShopAfterCustomSave: Shop | null = null;
    const customSaveResult = await saveShopOrderWorkflowConfig({
      shopId: 'wf-ui-shop',
      draft: customRulesDraft,
      locale: 'vi',
      fetchImpl: makeRouteFetch(ownerToken),
      onUpdateActiveShop: (s) => {
        reloadedDashboardShopAfterCustomSave = s;
      },
      onRefreshDashboard: async () => {
        const dashData = await dbGetAllShopsAndProfile(ownerId);
        reloadedDashboardShopAfterCustomSave =
          dashData.shops.find((s) => s.id === 'wf-ui-shop') ?? null;
      },
    });
    assert.equal(customSaveResult.ok, true);
    assert.ok(reloadedDashboardShopAfterCustomSave);
    assert.deepEqual(
      resolveShopOrderWorkflowConfig(
        (reloadedDashboardShopAfterCustomSave as Shop).theme_config
      ),
      validateOrderWorkflowConfig(customRulesDraft).config
    );

    // Subsequent general Settings PATCH that omits orderWorkflow preserves the saved custom workflow and unrelated theme_config keys
    const generalSettingsPatchRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          id: 'wf-ui-shop',
          name: 'Quán Cafe Flowchart Updated',
          theme_config: {
            primaryColor: '#0ea5e9',
            layout: 'list',
          },
        }),
      })
    );
    assert.equal(generalSettingsPatchRes.status, 200);
    const freshShopFromDb = await dbGetShopById('wf-ui-shop');
    assert.ok(freshShopFromDb);
    assert.equal(freshShopFromDb.theme_config.primaryColor, '#0ea5e9');
    assert.equal(freshShopFromDb.theme_config.paymentQr?.accountNo, '88889999');
    assert.deepEqual(
      resolveShopOrderWorkflowConfig(freshShopFromDb.theme_config),
      validateOrderWorkflowConfig(customRulesDraft).config
    );

    const reloadedEditorMarkup = renderToStaticMarkup(
      React.createElement(ShopOrderWorkflowEditor, {
        shop: freshShopFromDb,
        membership: { role: 'owner', permissions: [], is_active: true },
        locale: 'vi',
      })
    );
    assert.match(reloadedEditorMarkup, /Mẫu: Tùy chỉnh/);
    assert.match(
      reloadedEditorMarkup,
      /data-testid="workflow-step-card-tea_shake"/
    );
    assert.match(reloadedEditorMarkup, /Lắc trà &amp; đóng nắp/);

    // 6e. Simulated DB write failure and missing-row update return ok: false and never mutate persisted workflow
    simulateShopUpdateDbError = true;
    let updatedOnFailure: Shop | null = null;
    const failedDbSave = await saveShopOrderWorkflowConfig({
      shopId: 'wf-ui-shop',
      draft: getBuiltInOrderWorkflowTemplate('classic_kitchen'),
      locale: 'vi',
      fetchImpl: makeRouteFetch(ownerToken),
      onUpdateActiveShop: (s) => {
        updatedOnFailure = s;
      },
    });
    simulateShopUpdateDbError = false;
    assert.equal(failedDbSave.ok, false);
    assert.equal(updatedOnFailure, null);

    simulateShopUpdateNullRow = true;
    const nullRowSave = await saveShopOrderWorkflowConfig({
      shopId: 'wf-ui-shop',
      draft: getBuiltInOrderWorkflowTemplate('classic_kitchen'),
      locale: 'vi',
      fetchImpl: makeRouteFetch(ownerToken),
      onUpdateActiveShop: (s) => {
        updatedOnFailure = s;
      },
    });
    simulateShopUpdateNullRow = false;
    assert.equal(nullRowSave.ok, false);
    assert.equal(updatedOnFailure, null);

    const shopAfterFailedWrites = await dbGetShopById('wf-ui-shop');
    assert.deepEqual(
      resolveShopOrderWorkflowConfig(shopAfterFailedWrites?.theme_config),
      validateOrderWorkflowConfig(customRulesDraft).config,
      'persisted workflow must remain unchanged after failed DB writes'
    );

    // 7. Server-side rendering of ShopOrderWorkflowEditor component (owner interactive, validation alert, and staff read-only)
    const testShop: Shop = {
      id: 'wf-ui-shop',
      owner_id: ownerId,
      slug: 'wf-ui-shop',
      name: 'Quán Cafe Flowchart',
      tagline_i18n: { vi: '' },
      description_i18n: { vi: '' },
      vertical: 'fnb',
      logo_url: null,
      cover_urls: [],
      supported_langs: ['vi', 'en'],
      currency: 'VND',
      address: '',
      city: 'ha-noi',
      phone_contact: '',
      zalo_phone: '',
      google_maps_url: '',
      google_review_url: '',
      opening_hours: {
        mon: { open: '08:00', close: '22:00', closed: false },
        tue: { open: '08:00', close: '22:00', closed: false },
        wed: { open: '08:00', close: '22:00', closed: false },
        thu: { open: '08:00', close: '22:00', closed: false },
        fri: { open: '08:00', close: '22:00', closed: false },
        sat: { open: '08:00', close: '22:00', closed: false },
        sun: { open: '08:00', close: '22:00', closed: false },
      },
      wifi_info: { ssid: '', password: '' },
      theme_config: {
        primaryColor: '#10b981',
        layout: 'grid',
        fontStyle: 'modern',
        orderWorkflow: counterBar,
      },
      is_published: true,
      created_at: new Date().toISOString(),
    };

    const ownerMembership = {
      role: 'owner' as const,
      permissions: [],
      is_active: true,
    };
    const staffMembership = {
      role: 'staff' as const,
      permissions: ['settings.manage' as const],
      is_active: true,
    };

    assert.equal(canActorEditOrderWorkflow(ownerMembership, null), true);
    assert.equal(canActorEditOrderWorkflow(staffMembership, null), false);
    assert.equal(
      canActorEditOrderWorkflow(staffMembership, {
        role: 'admin',
        is_admin: true,
        email: 'hoangvu96z@gmail.com',
      }),
      true
    );

    const ownerHtmlVi = renderToStaticMarkup(
      React.createElement(ShopOrderWorkflowEditor, {
        shop: testShop,
        membership: ownerMembership,
        locale: 'vi',
        selectedStepIdOverride: 'bar_making',
      })
    );
    assert.match(ownerHtmlVi, /data-testid="order-workflow-settings"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-template-classic_kitchen"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-template-counter_bar_serve"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-template-simple_counter"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-template-custom"/);
    assert.match(ownerHtmlVi, /data-testid="order-workflow-flowchart"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-card-counter_received"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-card-bar_making"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-card-served"/);
    assert.match(
      ownerHtmlVi,
      /data-testid="workflow-edge-chip-counter_received-to-bar_making"/
    );
    assert.match(
      ownerHtmlVi,
      /data-testid="workflow-edge-chip-bar_making-to-served"/
    );
    assert.match(ownerHtmlVi, /data-testid="workflow-step-label-vi"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-label-en"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-action-vi"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-customer-vi"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-show-on-kds"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-step-suggest-label-print"/);
    assert.match(ownerHtmlVi, /data-testid="workflow-connect-bar_making-to-served"/);
    assert.match(ownerHtmlVi, /data-testid="order-workflow-save-button"/);
    assert.doesNotMatch(
      ownerHtmlVi,
      /<button(?![^>]*type="button")/,
      'every button inside ShopOrderWorkflowEditor must have type="button" to avoid submitting the outer Settings form'
    );

    // Invalid draft renders validation alert and disables save button
    const invalidHtmlEn = renderToStaticMarkup(
      React.createElement(ShopOrderWorkflowEditor, {
        shop: testShop,
        membership: ownerMembership,
        locale: 'en',
        initialDraftOverride: deadEndDraft,
      })
    );
    assert.match(invalidHtmlEn, /data-testid="order-workflow-validation-errors"/);
    assert.match(invalidHtmlEn, /Bar preparing/);
    assert.match(
      invalidHtmlEn,
      /data-testid="order-workflow-save-button"[^>]*disabled/
    );

    // Non-owner staff sees read-only badge and no save/add/delete action buttons
    const staffHtmlVi = renderToStaticMarkup(
      React.createElement(ShopOrderWorkflowEditor, {
        shop: testShop,
        membership: staffMembership,
        locale: 'vi',
      })
    );
    assert.match(staffHtmlVi, /data-testid="order-workflow-readonly-badge"/);
    assert.doesNotMatch(staffHtmlVi, /data-testid="order-workflow-save-button"/);
    assert.doesNotMatch(staffHtmlVi, /data-testid="workflow-add-preparing-step"/);
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    await db.close();
  }
});

test('Slice 4A: staff order list and KDS apply saved workflows, branching actions, KDS visibility flags, and concrete workflow_step_id PATCH payloads', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const {
    getStaffOrderWorkflowActions,
    resolveStaffOrderStepLabel,
  } = await import('@/lib/order-workflow');
  const {
    buildKitchenFulfillPatchPayload,
    isActiveKitchenOrder,
    isKitchenDisplayEnabled,
    selectAndSortKitchenOrders,
    summarizeKitchenQueue,
  } = await import('@/lib/kitchen-display');
  const { KitchenTicketCard } = await import(
    '@/components/dashboard/KitchenTicketCard'
  );

  // 1. Counter order list actions & labels for counter_bar_serve and simple_counter
  const counterBarWorkflow =
    getBuiltInOrderWorkflowTemplate('counter_bar_serve');
  const simpleCounterWorkflow =
    getBuiltInOrderWorkflowTemplate('simple_counter');

  assert.equal(
    resolveStaffOrderStepLabel(
      { status: 'new', workflow_step_id: 'counter_received' },
      counterBarWorkflow,
      'vi',
      'Mới nhận'
    ),
    'Thu ngân đã nhận'
  );
  assert.equal(
    resolveStaffOrderStepLabel(
      { status: 'new', workflow_step_id: 'counter_received' },
      counterBarWorkflow,
      'en',
      'New'
    ),
    'Counter received'
  );

  const counterBarNewActions = getStaffOrderWorkflowActions(
    { status: 'new', workflow_step_id: 'counter_received' },
    counterBarWorkflow,
    'vi'
  );
  assert.equal(counterBarNewActions.length, 1);
  assert.deepEqual(counterBarNewActions[0], {
    stepId: 'bar_making',
    stage: 'preparing',
    actionLabel: 'Pha chế & in tem',
    stepLabel: 'Quầy pha chế đang làm',
    suggestLabelPrint: true,
    patchPayload: {
      status: 'preparing',
      workflow_step_id: 'bar_making',
    },
  });

  const counterBarPrepActionsEn = getStaffOrderWorkflowActions(
    { status: 'preparing', workflow_step_id: 'bar_making' },
    counterBarWorkflow,
    'en'
  );
  assert.equal(counterBarPrepActionsEn.length, 1);
  assert.deepEqual(counterBarPrepActionsEn[0].patchPayload, {
    status: 'completed',
    workflow_step_id: 'served',
  });
  assert.equal(counterBarPrepActionsEn[0].actionLabel, 'Serve to customer');

  const simpleCounterActions = getStaffOrderWorkflowActions(
    { status: 'new', workflow_step_id: 'new' },
    simpleCounterWorkflow,
    'vi'
  );
  assert.equal(simpleCounterActions.length, 1);
  assert.deepEqual(simpleCounterActions[0].patchPayload, {
    status: 'completed',
    workflow_step_id: 'completed',
  });
  assert.equal(simpleCounterActions[0].actionLabel, 'Giao món xong');

  // 2. Custom branching workflow with 2 preparing branches (hot_kitchen on KDS, cold_bar counter-only)
  const branchingValidation = validateOrderWorkflowConfig({
    template_id: 'custom',
    kds_enabled: true,
    start_step_id: 'counter_intake',
    steps: [
      {
        id: 'counter_intake',
        stage: 'new',
        label_i18n: { vi: 'Thu ngân kiểm đơn', en: 'Cashier intake' },
        action_label_i18n: { vi: 'Nhận đơn', en: 'Intake order' },
        customer_label_i18n: { vi: 'Đã nhận đơn', en: 'Order received' },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: ['hot_kitchen', 'cold_bar'],
      },
      {
        id: 'hot_kitchen',
        stage: 'preparing',
        label_i18n: { vi: 'Bếp nóng đang nấu', en: 'Hot kitchen cooking' },
        action_label_i18n: { vi: 'Chuyển bếp nóng', en: 'Send to hot kitchen' },
        customer_label_i18n: { vi: 'Đang nấu món nóng', en: 'Cooking hot dish' },
        show_on_kds: true,
        suggest_label_print: false,
        next_step_ids: ['pass_ready', 'served_done'],
      },
      {
        id: 'cold_bar',
        stage: 'preparing',
        label_i18n: { vi: 'Quầy pha chế lạnh', en: 'Cold bar mixing' },
        action_label_i18n: { vi: 'Chuyển quầy lạnh', en: 'Send to cold bar' },
        customer_label_i18n: { vi: 'Đang pha đồ uống', en: 'Mixing drinks' },
        show_on_kds: false,
        suggest_label_print: true,
        next_step_ids: ['served_done'],
      },
      {
        id: 'pass_ready',
        stage: 'preparing',
        label_i18n: { vi: 'Chờ chạy bàn bưng', en: 'Ready at pass' },
        action_label_i18n: { vi: 'Ra món lên mâm', en: 'Plate at pass' },
        customer_label_i18n: { vi: 'Món đã xong chờ bưng', en: 'Ready to serve' },
        show_on_kds: true,
        suggest_label_print: false,
        next_step_ids: ['served_done'],
      },
      {
        id: 'served_done',
        stage: 'completed',
        label_i18n: { vi: 'Đã giao khách', en: 'Served to table' },
        action_label_i18n: { vi: 'Hoàn tất phục vụ', en: 'Complete service' },
        customer_label_i18n: { vi: 'Chúc ngon miệng', en: 'Enjoy your meal' },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: [],
      },
    ],
  });
  assert.equal(branchingValidation.valid, true);
  const branchingWorkflow = branchingValidation.config!;

  // At counter_intake, staff order list renders 2 distinct preparing branch buttons
  const intakeActionsVi = getStaffOrderWorkflowActions(
    { status: 'new', workflow_step_id: 'counter_intake' },
    branchingWorkflow,
    'vi'
  );
  assert.equal(intakeActionsVi.length, 2);
  assert.deepEqual(
    intakeActionsVi.map((a) => ({
      stepId: a.stepId,
      stage: a.stage,
      actionLabel: a.actionLabel,
      patchPayload: a.patchPayload,
    })),
    [
      {
        stepId: 'hot_kitchen',
        stage: 'preparing',
        actionLabel: 'Chuyển bếp nóng',
        patchPayload: { status: 'preparing', workflow_step_id: 'hot_kitchen' },
      },
      {
        stepId: 'cold_bar',
        stage: 'preparing',
        actionLabel: 'Chuyển quầy lạnh',
        patchPayload: { status: 'preparing', workflow_step_id: 'cold_bar' },
      },
    ]
  );

  // Fallback to canonical label when step is missing/unknown or ambiguous legacy preparing order
  assert.equal(
    resolveStaffOrderStepLabel(
      { status: 'preparing', workflow_step_id: 'removed_legacy_step' },
      branchingWorkflow,
      'vi',
      'Đang chuẩn bị'
    ),
    'Đang chuẩn bị'
  );
  assert.equal(
    resolveStaffOrderStepLabel(
      { status: 'preparing', workflow_step_id: null },
      branchingWorkflow,
      'en',
      'Preparing'
    ),
    'Preparing'
  );
  assert.equal(
    resolveStaffOrderStepLabel(
      { status: 'cancelled', workflow_step_id: 'hot_kitchen' },
      branchingWorkflow,
      'vi',
      'Đã hủy'
    ),
    'Đã hủy'
  );

  // 3. KDS visibility: kds_enabled === false hides all tickets; kds_enabled === true respects per-step show_on_kds
  assert.equal(isKitchenDisplayEnabled(counterBarWorkflow), false);
  assert.equal(isKitchenDisplayEnabled(simpleCounterWorkflow), false);
  assert.equal(isKitchenDisplayEnabled(branchingWorkflow), true);

  const nowMs = Date.parse('2026-10-24T10:30:00.000Z');
  const makeSampleOrder = (
    overrides: Partial<ShopOrder> & Pick<ShopOrder, 'id' | 'order_code' | 'status'>
  ): ShopOrder => ({
    id: overrides.id,
    shop_id: overrides.shop_id ?? 'shop-s4a',
    order_code: overrides.order_code,
    table_label: overrides.table_label ?? 'Bàn 1',
    visitor_lang: 'vi',
    items: overrides.items ?? [
      {
        item_id: 'item-1',
        name_vi: 'Phở bò tái lăn',
        name_i18n: { vi: 'Phở bò tái lăn', en: 'Stir-fried beef pho' },
        quantity: 2,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: [],
      },
    ],
    total_amount: 130000,
    status: overrides.status,
    workflow_step_id: overrides.workflow_step_id ?? null,
    payment_method: overrides.payment_method ?? 'cash',
    payment_status: 'unpaid',
    source: 'qr_table',
    created_at: overrides.created_at ?? '2026-10-24T10:10:00.000Z',
    updated_at:
      overrides.updated_at ?? overrides.created_at ?? '2026-10-24T10:10:00.000Z',
  });

  const orderAtIntake = makeSampleOrder({
    id: 'ord-intake',
    order_code: 'A01',
    status: 'new',
    workflow_step_id: 'counter_intake', // show_on_kds: false
    created_at: '2026-10-24T10:05:00.000Z',
  });
  const orderAtColdBar = makeSampleOrder({
    id: 'ord-cold',
    order_code: 'A02',
    status: 'preparing',
    workflow_step_id: 'cold_bar', // show_on_kds: false
    created_at: '2026-10-24T10:08:00.000Z',
  });
  const orderAtHotKitchen = makeSampleOrder({
    id: 'ord-hot',
    order_code: 'A03',
    status: 'preparing',
    workflow_step_id: 'hot_kitchen', // show_on_kds: true (20m old -> overdue)
    created_at: '2026-10-24T10:10:00.000Z',
  });
  const orderAtPass = makeSampleOrder({
    id: 'ord-pass',
    order_code: 'A04',
    status: 'preparing',
    workflow_step_id: 'pass_ready', // show_on_kds: true (5m old)
    created_at: '2026-10-24T10:25:00.000Z',
  });
  const sampleOrders = [
    orderAtIntake,
    orderAtColdBar,
    orderAtHotKitchen,
    orderAtPass,
  ];

  // When KDS is disabled (counter_bar_serve), KDS selects 0 orders and summary is all 0
  assert.deepEqual(
    selectAndSortKitchenOrders(sampleOrders, {
      shopId: 'shop-s4a',
      workflowConfig: counterBarWorkflow,
    }),
    []
  );
  assert.deepEqual(
    summarizeKitchenQueue(sampleOrders, {
      shopId: 'shop-s4a',
      nowMs,
      workflowConfig: counterBarWorkflow,
    }),
    { totalActive: 0, newCount: 0, preparingCount: 0, overdueCount: 0 }
  );

  // When KDS is enabled on branchingWorkflow, only steps with show_on_kds === true appear
  assert.equal(
    isActiveKitchenOrder(orderAtIntake, 'shop-s4a', branchingWorkflow),
    false
  );
  assert.equal(
    isActiveKitchenOrder(orderAtColdBar, 'shop-s4a', branchingWorkflow),
    false
  );
  assert.equal(
    isActiveKitchenOrder(orderAtHotKitchen, 'shop-s4a', branchingWorkflow),
    true
  );
  assert.equal(
    isActiveKitchenOrder(orderAtPass, 'shop-s4a', branchingWorkflow),
    true
  );

  const kdsVisible = selectAndSortKitchenOrders(sampleOrders, {
    shopId: 'shop-s4a',
    workflowConfig: branchingWorkflow,
  });
  assert.deepEqual(
    kdsVisible.map((o) => o.id),
    ['ord-hot', 'ord-pass']
  );

  const kdsSummary = summarizeKitchenQueue(sampleOrders, {
    shopId: 'shop-s4a',
    nowMs,
    workflowConfig: branchingWorkflow,
  });
  assert.deepEqual(kdsSummary, {
    totalActive: 2,
    newCount: 0,
    preparingCount: 2,
    overdueCount: 1,
  });

  // Legacy callers without workflowConfig still include all active ('new' + 'preparing') orders
  assert.equal(
    selectAndSortKitchenOrders(sampleOrders, { shopId: 'shop-s4a' }).length,
    4
  );

  // 4. KitchenTicketCard SSR rendering & buildKitchenFulfillPatchPayload for branching steps
  // At hot_kitchen, next steps are pass_ready (stage: 'preparing') and served_done (stage: 'completed')
  const hotTicketHtmlVi = renderToStaticMarkup(
    React.createElement(KitchenTicketCard, {
      order: orderAtHotKitchen,
      locale: 'vi',
      nowMs,
      canFulfill: true,
      workflowConfig: branchingWorkflow,
    })
  );
  assert.match(hotTicketHtmlVi, /Bếp nóng đang nấu/);
  assert.match(hotTicketHtmlVi, /data-workflow-step-id="hot_kitchen"/);
  assert.match(
    hotTicketHtmlVi,
    /data-testid="kds-action-step-ord-hot-pass_ready"/
  );
  assert.match(hotTicketHtmlVi, /Ra món lên mâm/);
  assert.match(
    hotTicketHtmlVi,
    /data-testid="kds-action-step-ord-hot-served_done"/
  );
  assert.match(hotTicketHtmlVi, /Hoàn tất phục vụ/);

  const passPayload = buildKitchenFulfillPatchPayload({
    shopId: 'shop-s4a',
    orderId: 'ord-hot',
    currentStatus: orderAtHotKitchen.status,
    currentWorkflowStepId: orderAtHotKitchen.workflow_step_id,
    targetWorkflowStepId: 'pass_ready',
    workflowConfig: branchingWorkflow,
  });
  assert.deepEqual(passPayload, {
    shop_id: 'shop-s4a',
    order_id: 'ord-hot',
    status: 'preparing',
    workflow_step_id: 'pass_ready',
  });

  const completePayload = buildKitchenFulfillPatchPayload({
    shopId: 'shop-s4a',
    orderId: 'ord-hot',
    currentStatus: orderAtHotKitchen.status,
    currentWorkflowStepId: orderAtHotKitchen.workflow_step_id,
    targetWorkflowStepId: 'served_done',
    workflowConfig: branchingWorkflow,
  });
  assert.deepEqual(completePayload, {
    shop_id: 'shop-s4a',
    order_id: 'ord-hot',
    status: 'completed',
    workflow_step_id: 'served_done',
  });

  // Disallowed target step returns null
  assert.equal(
    buildKitchenFulfillPatchPayload({
      shopId: 'shop-s4a',
      orderId: 'ord-hot',
      currentStatus: orderAtHotKitchen.status,
      currentWorkflowStepId: orderAtHotKitchen.workflow_step_id,
      targetWorkflowStepId: 'cold_bar',
      workflowConfig: branchingWorkflow,
    }),
    null
  );

  // 5. End-to-end API PATCH verification using the exact staff UI & KDS action payloads
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.waitReady;

  const ownerId = '00000000-0000-0000-0000-0000000004a1';
  const fulfillStaffId = '00000000-0000-0000-0000-0000000004a2';

  class PgQueryBuilder {
    private table: string;
    private columns = '*';
    private eqFilters: Array<[string, unknown]> = [];
    private neqFilters: Array<[string, unknown]> = [];
    private singleMode: 'none' | 'maybe' | 'single' = 'none';
    private updatePayload: Record<string, unknown> | null = null;
    private insertPayload: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }
    select(columns = '*') {
      this.columns = columns;
      return this;
    }
    eq(column: string, value: unknown) {
      this.eqFilters.push([column, value]);
      return this;
    }
    neq(column: string, value: unknown) {
      this.neqFilters.push([column, value]);
      return this;
    }
    order() {
      return this;
    }
    maybeSingle() {
      this.singleMode = 'maybe';
      return this;
    }
    single() {
      this.singleMode = 'single';
      return this;
    }
    insert(payload: Record<string, unknown>) {
      this.insertPayload = payload;
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }
    async execute() {
      const ident = (value: string) => `"${value}"`;
      const params: unknown[] = [];
      const buildWhere = () => {
        const clauses: string[] = [];
        for (const [col, val] of this.eqFilters) {
          params.push(val);
          clauses.push(`${ident(col)} = $${params.length}`);
        }
        for (const [col, val] of this.neqFilters) {
          params.push(val);
          clauses.push(`${ident(col)} <> $${params.length}`);
        }
        return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      };
      try {
        if (this.insertPayload) {
          const keys = Object.keys(this.insertPayload);
          const cols = keys.map(ident).join(', ');
          const vals = keys.map((k) => {
            const v = this.insertPayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `$${params.length}`;
          });
          const { rows } = await db.query(
            `INSERT INTO ${ident(this.table)} (${cols}) VALUES (${vals.join(', ')}) RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        if (this.updatePayload) {
          const keys = Object.keys(this.updatePayload);
          const setClauses = keys.map((k) => {
            const v = this.updatePayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `${ident(k)} = $${params.length}`;
          });
          const whereSql = buildWhere();
          const { rows } = await db.query(
            `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        const selectCols =
          this.columns === '*'
            ? '*'
            : this.columns
                .split(',')
                .map((c) => ident(c.trim()))
                .join(', ');
        const whereSql = buildWhere();
        const { rows } = await db.query(
          `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    then(
      resolve: (result: unknown) => unknown,
      reject: (err: unknown) => unknown
    ) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    from: (table: string) => new PgQueryBuilder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const names = Object.keys(args);
      const parameters = names.map((key, i) => `${key} => $${i + 1}`).join(', ');
      try {
        const { rows } = await db.query<{ result: unknown }>(
          `SELECT ${name}(${parameters}) AS result`,
          names.map((key) =>
            typeof args[key] === 'object' && args[key] !== null
              ? JSON.stringify(args[key])
              : args[key]
          )
        );
        return { data: rows[0]?.result ?? null, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };

  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
    for (const file of fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }

    await db.exec(`
      INSERT INTO profiles (id) VALUES
        ('${ownerId}'),
        ('${fulfillStaffId}');
      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES (
        'shop-s4a',
        '${ownerId}',
        'shop-s4a',
        'Quán S4A',
        true,
        '${JSON.stringify({ orderWorkflow: branchingWorkflow })}'::jsonb
      );
      INSERT INTO categories (id, shop_id, name_i18n) VALUES (
        'cat-s4a',
        'shop-s4a',
        '{"vi":"Món chính"}'::jsonb
      );
      INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, is_available) VALUES (
        'item-s4a',
        'shop-s4a',
        'cat-s4a',
        '{"vi":"Bún chả Hà Nội","en":"Hanoi Grilled Pork Noodles"}'::jsonb,
        60000,
        50,
        true
      );
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES (
        'mem-s4a-staff',
        'shop-s4a',
        '${fulfillStaffId}',
        'staff',
        '["orders.view","orders.fulfill"]'::jsonb,
        true
      );
    `);

    setSupabaseDbClientForTests(client as never);
    setMposDbClientForTests(client as never);
    setShopMembershipDbClientForTest(client as never);
    setShopTablesDbClientForTests(client as never);

    const createdOrder = await dbCreateOrder({
      shop_id: 'shop-s4a',
      table_label: 'Bàn 3',
      visitor_lang: 'vi',
      items: [
        {
          item_id: 'item-s4a',
          name_vi: 'Bún chả Hà Nội',
          quantity: 1,
          unit_price: 60000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
      source: 'counter_pos',
    });
    assert.equal(createdOrder.status, 'new');
    assert.equal(createdOrder.workflow_step_id, 'counter_intake');
    assert.equal(createdOrder.payment_status, 'unpaid');

    const staffToken = issueSessionToken({
      id: fulfillStaffId,
      email: 'kds-staff@qlaok.test',
      role: 'staff',
    });

    // Step 1: Counter Orders staff clicks the first branch button ('hot_kitchen')
    const counterActions = getStaffOrderWorkflowActions(
      createdOrder,
      branchingWorkflow,
      'vi'
    );
    const hotKitchenAction = counterActions.find(
      (a) => a.stepId === 'hot_kitchen'
    )!;
    assert.ok(hotKitchenAction);

    const patchToHotRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          shop_id: 'shop-s4a',
          order_id: createdOrder.id,
          ...hotKitchenAction.patchPayload,
        }),
      })
    );
    assert.equal(patchToHotRes.status, 200);
    const hotOrder: ShopOrder = (await patchToHotRes.json()).order;
    assert.equal(hotOrder.status, 'preparing');
    assert.equal(hotOrder.workflow_step_id, 'hot_kitchen');
    assert.equal(hotOrder.payment_status, 'unpaid');

    // Step 2: KDS now sees hotOrder (show_on_kds === true) and advances it to 'pass_ready' (still preparing!)
    assert.equal(
      isActiveKitchenOrder(hotOrder, 'shop-s4a', branchingWorkflow),
      true
    );
    const kdsToPassPayload = buildKitchenFulfillPatchPayload({
      shopId: 'shop-s4a',
      orderId: hotOrder.id,
      currentStatus: hotOrder.status,
      currentWorkflowStepId: hotOrder.workflow_step_id,
      targetWorkflowStepId: 'pass_ready',
      workflowConfig: branchingWorkflow,
    });
    assert.ok(kdsToPassPayload);

    const patchToPassRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(kdsToPassPayload),
      })
    );
    assert.equal(patchToPassRes.status, 200);
    const passOrder: ShopOrder = (await patchToPassRes.json()).order;
    assert.equal(passOrder.status, 'preparing');
    assert.equal(passOrder.workflow_step_id, 'pass_ready');
    assert.equal(passOrder.payment_status, 'unpaid');

    // Step 3: KDS advances from 'pass_ready' to 'served_done' (completed, unpaid)
    const kdsToServedPayload = buildKitchenFulfillPatchPayload({
      shopId: 'shop-s4a',
      orderId: passOrder.id,
      currentStatus: passOrder.status,
      currentWorkflowStepId: passOrder.workflow_step_id,
      targetWorkflowStepId: 'served_done',
      workflowConfig: branchingWorkflow,
    });
    assert.ok(kdsToServedPayload);

    const patchToServedRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(kdsToServedPayload),
      })
    );
    assert.equal(patchToServedRes.status, 200);
    const servedOrder: ShopOrder = (await patchToServedRes.json()).order;
    assert.equal(servedOrder.status, 'completed');
    assert.equal(servedOrder.workflow_step_id, 'served_done');
    assert.equal(
      servedOrder.payment_status,
      'unpaid',
      'completing service via KDS/counter workflow must never mark the order paid'
    );
  } finally {
    setSupabaseDbClientForTests(null);
    setMposDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setShopTablesDbClientForTests(null);
    await db.close();
  }
});

test('Slice 4B: Settings page composition mounts ShopOrderWorkflowEditor and ShopLabelPrintSettingsEditor before ShopMembersManager without form collision', () => {
  const mockSource = JSON.stringify(`
    export function useDashboard() {
      return {
        activeShop: {
          id: "shop-test-1",
          slug: "shop-test",
          name: "Test Shop",
          vertical: "fnb",
          currency: "VND",
          theme_config: {},
          supported_langs: ["vi", "en"],
          opening_hours_confirmed: true,
          opening_hours: {
            monday: { open: "08:00", close: "22:00", closed: false },
            tuesday: { open: "08:00", close: "22:00", closed: false },
            wednesday: { open: "08:00", close: "22:00", closed: false },
            thursday: { open: "08:00", close: "22:00", closed: false },
            friday: { open: "08:00", close: "22:00", closed: false },
            saturday: { open: "08:00", close: "22:00", closed: false },
            sunday: { open: "08:00", close: "22:00", closed: false }
          }
        },
        activeMembership: { role: "owner", permissions: ["settings.manage"], is_active: true },
        profile: { role: "owner", is_admin: false },
        updateActiveShop() {},
        refreshDashboard() {},
      };
    }
  `);

  const ssrScript = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { registerHooks } from "node:module";

    registerHooks({
      load(url, context, next) {
        if (url.includes("dashboard-context")) {
          return {
            format: "module",
            shortCircuit: true,
            source: ${mockSource},
          };
        }
        return next(url, context);
      }
    });

    const { default: SettingsPage } = await import("./src/app/(dashboard)/dashboard/settings/page.tsx");
    const html = renderToStaticMarkup(React.createElement(SettingsPage));

    const openingHoursIdx = html.indexOf('id="opening-hours-settings"');
    const workflowIdx = html.indexOf('data-testid="order-workflow-settings"');
    const labelIdx = html.indexOf('data-testid="label-print-settings"');
    const membersIdx = html.indexOf('data-testid="shop-members-manager"');

    const workflowHtml = workflowIdx !== -1 && labelIdx !== -1 ? html.slice(workflowIdx, labelIdx) : "";
    const labelHtml = labelIdx !== -1 && membersIdx !== -1 ? html.slice(labelIdx, membersIdx) : "";

    const extractButtons = (str) => {
      const list = [];
      let start = 0;
      while ((start = str.indexOf("<button", start)) !== -1) {
        const end = str.indexOf(">", start);
        if (end !== -1) {
          list.push(str.slice(start, end + 1));
          start = end + 1;
        } else {
          break;
        }
      }
      return list;
    };

    const workflowButtons = extractButtons(workflowHtml);
    const labelButtons = extractButtons(labelHtml);

    const workflowButtonsAllTypeButton = workflowButtons.length > 0 && workflowButtons.every(b => b.includes('type="button"'));
    const labelButtonsAllTypeButton = labelButtons.length > 0 && labelButtons.every(b => b.includes('type="button"'));

    console.log(JSON.stringify({
      hasWorkflowSection: workflowIdx !== -1,
      hasLabelSection: labelIdx !== -1,
      hasMembersSection: membersIdx !== -1,
      isMountedNearEndBeforeMembers: openingHoursIdx !== -1 && openingHoursIdx < workflowIdx && workflowIdx < labelIdx && labelIdx < membersIdx,
      workflowButtonsCount: workflowButtons.length,
      labelButtonsCount: labelButtons.length,
      workflowButtonsAllTypeButton,
      labelButtonsAllTypeButton,
    }));
  `;

  const rawOut = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      './tests/register-ts.mjs',
      '--import',
      './tests/tsx-review-loader.mjs',
      '--input-type=module',
      '-e',
      ssrScript,
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 }
  );

  const jsonLine = rawOut.trim().split('\\n').find((l) => l.startsWith('{'));
  assert.ok(jsonLine, 'SSR script must output json result');
  const result = JSON.parse(jsonLine);

  assert.equal(
    result.hasWorkflowSection,
    true,
    'Settings page must render ShopOrderWorkflowEditor (data-testid="order-workflow-settings")'
  );
  assert.equal(
    result.hasLabelSection,
    true,
    'Settings page must render ShopLabelPrintSettingsEditor (data-testid="label-print-settings")'
  );
  assert.equal(
    result.hasMembersSection,
    true,
    'Settings page must render ShopMembersManager (data-testid="shop-members-manager")'
  );
  assert.equal(
    result.isMountedNearEndBeforeMembers,
    true,
    'Order workflow and label print sections must be mounted near the end of settings and before ShopMembersManager'
  );
  assert.equal(
    result.workflowButtonsAllTypeButton,
    true,
    'All control buttons in order workflow section must have type="button" to prevent submitting the outer settings form'
  );
  assert.equal(
    result.labelButtonsAllTypeButton,
    true,
    'All control buttons in label print section must have type="button" to prevent submitting the outer settings form'
  );
});
