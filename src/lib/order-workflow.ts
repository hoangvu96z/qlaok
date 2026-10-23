import type {
  I18nText,
  OrderStatus,
  OrderWorkflowStepConfig,
  OrderWorkflowStepStage,
  OrderWorkflowTemplateId,
  ShopOrder,
  ShopOrderWorkflowConfig,
  ShopThemeConfig,
  SupportedLocale,
} from '@/types/qlaok';

export * from '@/lib/label-print-config';

export const VALID_WORKFLOW_TEMPLATE_IDS: readonly OrderWorkflowTemplateId[] = [
  'classic_kitchen',
  'counter_bar_serve',
  'simple_counter',
  'custom',
] as const;

export const VALID_WORKFLOW_STEP_STAGES: readonly OrderWorkflowStepStage[] = [
  'new',
  'preparing',
  'completed',
] as const;

export const WORKFLOW_STAGE_RANK: Record<OrderWorkflowStepStage, number> = {
  new: 0,
  preparing: 1,
  completed: 2,
};

export const MIN_WORKFLOW_STEPS = 2;
export const MAX_WORKFLOW_STEPS = 8;
export const MAX_WORKFLOW_LABEL_LENGTH = 80;
export const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

const FORBIDDEN_STEP_IDS = new Set(['cancelled', 'cancel', 'canceled']);

const FORBIDDEN_PAYMENT_MUTATION_KEYS = new Set([
  'payment_status',
  'payment_method',
  'mark_paid',
  'auto_pay',
  'collect_payment',
  'refund',
  'paid',
]);

export const BUILT_IN_ORDER_WORKFLOW_TEMPLATES: Record<
  Exclude<OrderWorkflowTemplateId, 'custom'>,
  ShopOrderWorkflowConfig
> = {
  classic_kitchen: {
    template_id: 'classic_kitchen',
    kds_enabled: true,
    start_step_id: 'new',
    steps: [
      {
        id: 'new',
        stage: 'new',
        label_i18n: {
          vi: 'Chờ bếp nhận',
          en: 'New Order',
        },
        action_label_i18n: {
          vi: 'Tiếp nhận',
          en: 'Receive',
        },
        customer_label_i18n: {
          vi: 'Đã gửi bếp',
          en: 'Sent to kitchen',
        },
        show_on_kds: true,
        suggest_label_print: false,
        next_step_ids: ['preparing'],
      },
      {
        id: 'preparing',
        stage: 'preparing',
        label_i18n: {
          vi: 'Bếp đang làm',
          en: 'Preparing',
        },
        action_label_i18n: {
          vi: 'Bắt đầu làm',
          en: 'Start preparing',
        },
        customer_label_i18n: {
          vi: 'Bếp đang chuẩn bị món',
          en: 'Kitchen is preparing your order',
        },
        show_on_kds: true,
        suggest_label_print: false,
        next_step_ids: ['completed'],
      },
      {
        id: 'completed',
        stage: 'completed',
        label_i18n: {
          vi: 'Đã phục vụ',
          en: 'Completed',
        },
        action_label_i18n: {
          vi: 'Hoàn tất phục vụ',
          en: 'Complete service',
        },
        customer_label_i18n: {
          vi: 'Đã phục vụ xong',
          en: 'Order served',
        },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: [],
      },
    ],
  },
  counter_bar_serve: {
    template_id: 'counter_bar_serve',
    kds_enabled: false,
    start_step_id: 'counter_received',
    steps: [
      {
        id: 'counter_received',
        stage: 'new',
        label_i18n: {
          vi: 'Thu ngân đã nhận',
          en: 'Counter received',
        },
        action_label_i18n: {
          vi: 'Nhận tại quầy',
          en: 'Receive at counter',
        },
        customer_label_i18n: {
          vi: 'Quầy đã nhận đơn',
          en: 'Order received at counter',
        },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: ['bar_making'],
      },
      {
        id: 'bar_making',
        stage: 'preparing',
        label_i18n: {
          vi: 'Quầy pha chế đang làm',
          en: 'Bar preparing',
        },
        action_label_i18n: {
          vi: 'Pha chế & in tem',
          en: 'Prepare & print label',
        },
        customer_label_i18n: {
          vi: 'Đang pha chế đồ uống',
          en: 'Preparing your drinks',
        },
        show_on_kds: false,
        suggest_label_print: true,
        next_step_ids: ['served'],
      },
      {
        id: 'served',
        stage: 'completed',
        label_i18n: {
          vi: 'Đã giao món',
          en: 'Served',
        },
        action_label_i18n: {
          vi: 'Giao món cho khách',
          en: 'Serve to customer',
        },
        customer_label_i18n: {
          vi: 'Đã giao món xong',
          en: 'Order served',
        },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: [],
      },
    ],
  },
  simple_counter: {
    template_id: 'simple_counter',
    kds_enabled: false,
    start_step_id: 'new',
    steps: [
      {
        id: 'new',
        stage: 'new',
        label_i18n: {
          vi: 'Mới nhận tại quầy',
          en: 'New at counter',
        },
        action_label_i18n: {
          vi: 'Nhận đơn',
          en: 'Receive order',
        },
        customer_label_i18n: {
          vi: 'Quầy đã nhận đơn',
          en: 'Order received',
        },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: ['completed'],
      },
      {
        id: 'completed',
        stage: 'completed',
        label_i18n: {
          vi: 'Đã giao ngay',
          en: 'Served',
        },
        action_label_i18n: {
          vi: 'Giao món xong',
          en: 'Mark served',
        },
        customer_label_i18n: {
          vi: 'Đã phục vụ xong',
          en: 'Order served',
        },
        show_on_kds: false,
        suggest_label_print: false,
        next_step_ids: [],
      },
    ],
  },
};

export function cloneWorkflowConfig(
  config: ShopOrderWorkflowConfig
): ShopOrderWorkflowConfig {
  return {
    template_id: config.template_id,
    kds_enabled: config.kds_enabled,
    start_step_id: config.start_step_id,
    steps: config.steps.map((step) => ({
      id: step.id,
      stage: step.stage,
      label_i18n: { ...step.label_i18n },
      action_label_i18n: { ...step.action_label_i18n },
      customer_label_i18n: step.customer_label_i18n
        ? { ...step.customer_label_i18n }
        : { ...step.label_i18n },
      show_on_kds: step.show_on_kds,
      suggest_label_print: Boolean(step.suggest_label_print),
      next_step_ids: [...step.next_step_ids],
    })),
  };
}

export function getBuiltInOrderWorkflowTemplate(
  templateId: Exclude<OrderWorkflowTemplateId, 'custom'> = 'classic_kitchen'
): ShopOrderWorkflowConfig {
  const found =
    BUILT_IN_ORDER_WORKFLOW_TEMPLATES[templateId] ??
    BUILT_IN_ORDER_WORKFLOW_TEMPLATES.classic_kitchen;
  return cloneWorkflowConfig(found);
}

export const DEFAULT_SHOP_ORDER_WORKFLOW_CONFIG: ShopOrderWorkflowConfig =
  getBuiltInOrderWorkflowTemplate('classic_kitchen');

export type OrderWorkflowValidationErrorCode =
  | 'INVALID_CONFIG_OBJECT'
  | 'FORBIDDEN_PAYMENT_MUTATION_FIELD'
  | 'INVALID_TEMPLATE_ID'
  | 'INVALID_KDS_FLAG'
  | 'TOO_FEW_STEPS'
  | 'TOO_MANY_STEPS'
  | 'INVALID_STEP_OBJECT'
  | 'CANCELLATION_NOT_ALLOWED_IN_WORKFLOW'
  | 'INVALID_STEP_ID'
  | 'DUPLICATE_STEP_ID'
  | 'INVALID_STEP_STAGE'
  | 'MISSING_STEP_LABEL'
  | 'LABEL_TOO_LONG'
  | 'UNSAFE_STEP_LABEL'
  | 'INVALID_STEP_FLAG'
  | 'INVALID_NEXT_STEPS'
  | 'SELF_LOOP_EDGE'
  | 'DUPLICATE_EDGE'
  | 'UNKNOWN_NEXT_STEP'
  | 'INVALID_START_STEP'
  | 'START_STEP_MUST_BE_NEW_STAGE'
  | 'MULTIPLE_NEW_STAGE_STEPS'
  | 'MISSING_TERMINAL_STEP'
  | 'TERMINAL_STEP_HAS_OUTGOING_EDGES'
  | 'DEAD_END_STEP'
  | 'STAGE_REGRESSION_EDGE'
  | 'WORKFLOW_CYCLE_DETECTED'
  | 'UNREACHABLE_STEP';

export interface OrderWorkflowValidationError {
  code: OrderWorkflowValidationErrorCode;
  step_id?: string;
  field?: string;
  message: string;
}

export type OrderWorkflowValidationResult =
  | {
      valid: true;
      config: ShopOrderWorkflowConfig;
      errors: [];
    }
  | {
      valid: false;
      config: null;
      errors: OrderWorkflowValidationError[];
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnsafeControlOrMarkup(text: string): boolean {
  if (/[<>]/.test(text)) return true;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export function resolveWorkflowLocalizedText(
  field: I18nText | undefined | null,
  locale: SupportedLocale = 'vi'
): string {
  if (!field) return '';
  return (
    field[locale]?.trim() ||
    field.vi?.trim() ||
    field.en?.trim() ||
    ''
  );
}

function normalizeStepI18nField(
  rawStep: Record<string, unknown>,
  i18nKey: string,
  viFallbackKey: string,
  enFallbackKey: string,
  fallbackI18n: I18nText | null,
  stepIdForError: string,
  errors: OrderWorkflowValidationError[]
): I18nText | null {
  const rawI18n = rawStep[i18nKey];
  const rawViFlat = rawStep[viFallbackKey];
  const rawEnFlat = rawStep[enFallbackKey];

  let vi = '';
  let en = '';

  if (rawI18n !== undefined && rawI18n !== null) {
    if (!isPlainObject(rawI18n)) {
      errors.push({
        code: 'MISSING_STEP_LABEL',
        step_id: stepIdForError,
        field: i18nKey,
        message: `${i18nKey} on step "${stepIdForError}" must be an I18nText object.`,
      });
      return null;
    }
    if (
      (rawI18n.vi !== undefined && typeof rawI18n.vi !== 'string') ||
      (rawI18n.en !== undefined && typeof rawI18n.en !== 'string')
    ) {
      errors.push({
        code: 'MISSING_STEP_LABEL',
        step_id: stepIdForError,
        field: i18nKey,
        message: `${i18nKey}.vi and ${i18nKey}.en on step "${stepIdForError}" must be strings.`,
      });
      return null;
    }
    vi = (rawI18n.vi ?? '').trim();
    en = (rawI18n.en ?? '').trim();
  } else if (rawViFlat !== undefined || rawEnFlat !== undefined) {
    if (
      (rawViFlat !== undefined && typeof rawViFlat !== 'string') ||
      (rawEnFlat !== undefined && typeof rawEnFlat !== 'string')
    ) {
      errors.push({
        code: 'MISSING_STEP_LABEL',
        step_id: stepIdForError,
        field: i18nKey,
        message: `${viFallbackKey}/${enFallbackKey} on step "${stepIdForError}" must be strings.`,
      });
      return null;
    }
    vi = (rawViFlat ?? '').trim();
    en = (rawEnFlat ?? '').trim();
  } else if (fallbackI18n) {
    return {
      vi: fallbackI18n.vi,
      en: fallbackI18n.en ?? fallbackI18n.vi,
    };
  } else {
    errors.push({
      code: 'MISSING_STEP_LABEL',
      step_id: stepIdForError,
      field: i18nKey,
      message: `Step "${stepIdForError}" requires ${i18nKey} with non-empty VI or EN text.`,
    });
    return null;
  }

  const resolvedVi = vi || en;
  const resolvedEn = en || vi;

  if (!resolvedVi) {
    if (fallbackI18n) {
      return {
        vi: fallbackI18n.vi,
        en: fallbackI18n.en ?? fallbackI18n.vi,
      };
    }
    errors.push({
      code: 'MISSING_STEP_LABEL',
      step_id: stepIdForError,
      field: i18nKey,
      message: `Step "${stepIdForError}" requires non-empty ${i18nKey} text.`,
    });
    return null;
  }

  if (
    resolvedVi.length > MAX_WORKFLOW_LABEL_LENGTH ||
    resolvedEn.length > MAX_WORKFLOW_LABEL_LENGTH
  ) {
    errors.push({
      code: 'LABEL_TOO_LONG',
      step_id: stepIdForError,
      field: i18nKey,
      message: `${i18nKey} on step "${stepIdForError}" must not exceed ${MAX_WORKFLOW_LABEL_LENGTH} characters.`,
    });
    return null;
  }

  if (
    hasUnsafeControlOrMarkup(resolvedVi) ||
    hasUnsafeControlOrMarkup(resolvedEn)
  ) {
    errors.push({
      code: 'UNSAFE_STEP_LABEL',
      step_id: stepIdForError,
      field: i18nKey,
      message: `${i18nKey} on step "${stepIdForError}" must not contain HTML markup or control characters.`,
    });
    return null;
  }

  return {
    vi: resolvedVi,
    en: resolvedEn,
  };
}

export function validateOrderWorkflowConfig(
  raw: unknown
): OrderWorkflowValidationResult {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      config: null,
      errors: [
        {
          code: 'INVALID_CONFIG_OBJECT',
          field: 'orderWorkflow',
          message: 'Order workflow configuration must be a plain object.',
        },
      ],
    };
  }

  const errors: OrderWorkflowValidationError[] = [];

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_PAYMENT_MUTATION_KEYS.has(key)) {
      errors.push({
        code: 'FORBIDDEN_PAYMENT_MUTATION_FIELD',
        field: key,
        message: `Workflow configuration must not include payment-state field "${key}".`,
      });
    }
  }

  let templateId: OrderWorkflowTemplateId = 'custom';
  if (raw.template_id !== undefined) {
    if (
      typeof raw.template_id !== 'string' ||
      !VALID_WORKFLOW_TEMPLATE_IDS.includes(
        raw.template_id as OrderWorkflowTemplateId
      )
    ) {
      errors.push({
        code: 'INVALID_TEMPLATE_ID',
        field: 'template_id',
        message: `template_id must be one of: ${VALID_WORKFLOW_TEMPLATE_IDS.join(', ')}.`,
      });
    } else {
      templateId = raw.template_id as OrderWorkflowTemplateId;
    }
  }

  if (raw.kds_enabled !== undefined && typeof raw.kds_enabled !== 'boolean') {
    errors.push({
      code: 'INVALID_KDS_FLAG',
      field: 'kds_enabled',
      message: 'kds_enabled must be a boolean.',
    });
  }

  if (
    typeof raw.start_step_id !== 'string' ||
    raw.start_step_id.trim().length === 0
  ) {
    errors.push({
      code: 'INVALID_START_STEP',
      field: 'start_step_id',
      message: 'start_step_id must be a non-empty string.',
    });
  }
  const startStepId =
    typeof raw.start_step_id === 'string' ? raw.start_step_id.trim() : '';

  if (!Array.isArray(raw.steps)) {
    errors.push({
      code: 'TOO_FEW_STEPS',
      field: 'steps',
      message: `steps must be an array of ${MIN_WORKFLOW_STEPS} to ${MAX_WORKFLOW_STEPS} steps.`,
    });
    return { valid: false, config: null, errors };
  }

  if (raw.steps.length < MIN_WORKFLOW_STEPS) {
    errors.push({
      code: 'TOO_FEW_STEPS',
      field: 'steps',
      message: `Workflow must have at least ${MIN_WORKFLOW_STEPS} steps.`,
    });
  }

  if (raw.steps.length > MAX_WORKFLOW_STEPS) {
    errors.push({
      code: 'TOO_MANY_STEPS',
      field: 'steps',
      message: `Workflow cannot exceed ${MAX_WORKFLOW_STEPS} steps.`,
    });
  }

  const normalizedSteps: OrderWorkflowStepConfig[] = [];
  const stepById = new Map<string, OrderWorkflowStepConfig>();

  for (let idx = 0; idx < raw.steps.length; idx += 1) {
    const rawStep = raw.steps[idx];
    if (!isPlainObject(rawStep)) {
      errors.push({
        code: 'INVALID_STEP_OBJECT',
        field: `steps[${idx}]`,
        message: `Step at index ${idx} must be a plain object.`,
      });
      continue;
    }

    const rawId = typeof rawStep.id === 'string' ? rawStep.id.trim() : '';
    const stepRef = rawId || `steps[${idx}]`;

    for (const key of Object.keys(rawStep)) {
      if (FORBIDDEN_PAYMENT_MUTATION_KEYS.has(key)) {
        errors.push({
          code: 'FORBIDDEN_PAYMENT_MUTATION_FIELD',
          step_id: stepRef,
          field: key,
          message: `Step "${stepRef}" must not include payment-state field "${key}".`,
        });
      }
    }

    if (FORBIDDEN_STEP_IDS.has(rawId.toLowerCase())) {
      errors.push({
        code: 'CANCELLATION_NOT_ALLOWED_IN_WORKFLOW',
        step_id: stepRef,
        field: 'id',
        message: 'Cancellation is not a workflow node and cannot be used as a step ID.',
      });
    } else if (!STEP_ID_PATTERN.test(rawId)) {
      errors.push({
        code: 'INVALID_STEP_ID',
        step_id: stepRef,
        field: 'id',
        message: `Step ID "${rawId}" must be 2–32 lowercase alphanumeric, underscore, or hyphen characters.`,
      });
    } else if (stepById.has(rawId)) {
      errors.push({
        code: 'DUPLICATE_STEP_ID',
        step_id: rawId,
        field: 'id',
        message: `Duplicate step ID "${rawId}".`,
      });
    }

    const rawStage = rawStep.stage;
    if (
      typeof rawStage === 'string' &&
      FORBIDDEN_STEP_IDS.has(rawStage.toLowerCase())
    ) {
      errors.push({
        code: 'CANCELLATION_NOT_ALLOWED_IN_WORKFLOW',
        step_id: stepRef,
        field: 'stage',
        message: 'Cancellation is not a workflow stage.',
      });
    } else if (
      typeof rawStage !== 'string' ||
      !VALID_WORKFLOW_STEP_STAGES.includes(rawStage as OrderWorkflowStepStage)
    ) {
      errors.push({
        code: 'INVALID_STEP_STAGE',
        step_id: stepRef,
        field: 'stage',
        message: `Step "${stepRef}" has invalid stage; must be new, preparing, or completed.`,
      });
    }

    const labelI18n = normalizeStepI18nField(
      rawStep,
      'label_i18n',
      'label_vi',
      'label_en',
      null,
      stepRef,
      errors
    );
    const actionLabelI18n = normalizeStepI18nField(
      rawStep,
      'action_label_i18n',
      'action_label_vi',
      'action_label_en',
      labelI18n,
      stepRef,
      errors
    );
    const customerLabelI18n = normalizeStepI18nField(
      rawStep,
      'customer_label_i18n',
      'customer_label_vi',
      'customer_label_en',
      labelI18n,
      stepRef,
      errors
    );

    if (
      rawStep.show_on_kds !== undefined &&
      typeof rawStep.show_on_kds !== 'boolean'
    ) {
      errors.push({
        code: 'INVALID_STEP_FLAG',
        step_id: stepRef,
        field: 'show_on_kds',
        message: `show_on_kds on step "${stepRef}" must be a boolean.`,
      });
    }

    const rawSuggestLabel =
      rawStep.suggest_label_print !== undefined
        ? rawStep.suggest_label_print
        : rawStep.auto_suggest_label_print;
    if (
      rawSuggestLabel !== undefined &&
      typeof rawSuggestLabel !== 'boolean'
    ) {
      errors.push({
        code: 'INVALID_STEP_FLAG',
        step_id: stepRef,
        field: 'suggest_label_print',
        message: `suggest_label_print on step "${stepRef}" must be a boolean.`,
      });
    }

    if (!Array.isArray(rawStep.next_step_ids)) {
      errors.push({
        code: 'INVALID_NEXT_STEPS',
        step_id: stepRef,
        field: 'next_step_ids',
        message: `next_step_ids on step "${stepRef}" must be an array of step IDs.`,
      });
    }

    const nextStepIds: string[] = [];
    const seenEdges = new Set<string>();
    if (Array.isArray(rawStep.next_step_ids)) {
      for (const rawTarget of rawStep.next_step_ids) {
        if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
          errors.push({
            code: 'INVALID_NEXT_STEPS',
            step_id: stepRef,
            field: 'next_step_ids',
            message: `next_step_ids on step "${stepRef}" must contain non-empty string IDs.`,
          });
          continue;
        }
        const targetId = rawTarget.trim();
        if (targetId === rawId) {
          errors.push({
            code: 'SELF_LOOP_EDGE',
            step_id: stepRef,
            field: 'next_step_ids',
            message: `Step "${stepRef}" cannot transition to itself.`,
          });
          continue;
        }
        if (seenEdges.has(targetId)) {
          errors.push({
            code: 'DUPLICATE_EDGE',
            step_id: stepRef,
            field: 'next_step_ids',
            message: `Step "${stepRef}" has duplicate outgoing edge to "${targetId}".`,
          });
          continue;
        }
        seenEdges.add(targetId);
        nextStepIds.push(targetId);
      }
    }

    if (
      rawId &&
      STEP_ID_PATTERN.test(rawId) &&
      !FORBIDDEN_STEP_IDS.has(rawId.toLowerCase()) &&
      !stepById.has(rawId) &&
      typeof rawStage === 'string' &&
      VALID_WORKFLOW_STEP_STAGES.includes(rawStage as OrderWorkflowStepStage) &&
      labelI18n &&
      actionLabelI18n &&
      customerLabelI18n
    ) {
      const stage = rawStage as OrderWorkflowStepStage;
      const stepObj: OrderWorkflowStepConfig = {
        id: rawId,
        stage,
        label_i18n: labelI18n,
        action_label_i18n: actionLabelI18n,
        customer_label_i18n: customerLabelI18n,
        show_on_kds:
          stage === 'completed' ? false : Boolean(rawStep.show_on_kds),
        suggest_label_print: Boolean(rawSuggestLabel),
        next_step_ids: nextStepIds,
      };
      normalizedSteps.push(stepObj);
      stepById.set(rawId, stepObj);
    }
  }

  if (errors.length > 0) {
    return { valid: false, config: null, errors };
  }

  // Validate start_step_id exists and has stage === 'new'
  const startStep = stepById.get(startStepId);
  if (!startStep) {
    errors.push({
      code: 'INVALID_START_STEP',
      field: 'start_step_id',
      message: `start_step_id "${startStepId}" does not exist in steps.`,
    });
  } else if (startStep.stage !== 'new') {
    errors.push({
      code: 'START_STEP_MUST_BE_NEW_STAGE',
      step_id: startStep.id,
      field: 'stage',
      message: `Start step "${startStep.id}" must have stage="new".`,
    });
  }

  // Enforce exactly one stage === 'new' step (the start step)
  const newStageSteps = normalizedSteps.filter((s) => s.stage === 'new');
  if (newStageSteps.length !== 1 || newStageSteps[0]?.id !== startStepId) {
    errors.push({
      code: 'MULTIPLE_NEW_STAGE_STEPS',
      field: 'steps',
      message:
        'Workflow must have exactly one step with stage="new", and it must be start_step_id.',
    });
  }

  // Require at least one terminal (stage === 'completed') step
  const completedSteps = normalizedSteps.filter((s) => s.stage === 'completed');
  if (completedSteps.length === 0) {
    errors.push({
      code: 'MISSING_TERMINAL_STEP',
      field: 'steps',
      message: 'Workflow must include at least one terminal step with stage="completed".',
    });
  }

  // Check edges: target existence, terminal outgoing rules, non-terminal outgoing rules, stage regression
  for (const step of normalizedSteps) {
    if (step.stage === 'completed' && step.next_step_ids.length > 0) {
      errors.push({
        code: 'TERMINAL_STEP_HAS_OUTGOING_EDGES',
        step_id: step.id,
        field: 'next_step_ids',
        message: `Completed step "${step.id}" is terminal and cannot have outgoing next_step_ids.`,
      });
    } else if (step.stage !== 'completed' && step.next_step_ids.length === 0) {
      errors.push({
        code: 'DEAD_END_STEP',
        step_id: step.id,
        field: 'next_step_ids',
        message: `Non-completed step "${step.id}" must have at least one outgoing transition.`,
      });
    }

    for (const targetId of step.next_step_ids) {
      const targetStep = stepById.get(targetId);
      if (!targetStep) {
        errors.push({
          code: 'UNKNOWN_NEXT_STEP',
          step_id: step.id,
          field: 'next_step_ids',
          message: `Step "${step.id}" references unknown next step "${targetId}".`,
        });
        continue;
      }

      if (
        WORKFLOW_STAGE_RANK[targetStep.stage] < WORKFLOW_STAGE_RANK[step.stage]
      ) {
        errors.push({
          code: 'STAGE_REGRESSION_EDGE',
          step_id: step.id,
          field: 'next_step_ids',
          message: `Transition from "${step.id}" (${step.stage}) to "${targetStep.id}" (${targetStep.stage}) regresses canonical stage.`,
        });
      }
    }
  }

  // Detect cycles via 3-color DFS across all nodes
  const color = new Map<string, 0 | 1 | 2>();
  for (const step of normalizedSteps) {
    color.set(step.id, 0);
  }
  let cycleDetected = false;

  function dfsCycle(stepId: string): void {
    color.set(stepId, 1);
    const step = stepById.get(stepId);
    if (step) {
      for (const nextId of step.next_step_ids) {
        if (!stepById.has(nextId)) continue;
        const nextColor = color.get(nextId) ?? 0;
        if (nextColor === 1) {
          cycleDetected = true;
          errors.push({
            code: 'WORKFLOW_CYCLE_DETECTED',
            step_id: stepId,
            field: 'next_step_ids',
            message: `Cycle detected in workflow graph involving step "${stepId}" -> "${nextId}".`,
          });
        } else if (nextColor === 0) {
          dfsCycle(nextId);
        }
      }
    }
    color.set(stepId, 2);
  }

  for (const step of normalizedSteps) {
    if ((color.get(step.id) ?? 0) === 0) {
      dfsCycle(step.id);
    }
  }

  // Check reachability from start_step_id
  if (startStep) {
    const reachableFromStart = new Set<string>();
    const queue: string[] = [startStep.id];
    reachableFromStart.add(startStep.id);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      const curr = stepById.get(currId);
      if (!curr) continue;
      for (const nextId of curr.next_step_ids) {
        if (stepById.has(nextId) && !reachableFromStart.has(nextId)) {
          reachableFromStart.add(nextId);
          queue.push(nextId);
        }
      }
    }

    for (const step of normalizedSteps) {
      if (!reachableFromStart.has(step.id)) {
        errors.push({
          code: 'UNREACHABLE_STEP',
          step_id: step.id,
          field: 'steps',
          message: `Step "${step.id}" is unreachable from start_step_id "${startStep.id}".`,
        });
      }
    }
  }

  // Check that every step can reach at least one completed step (no dead-end subgraph)
  if (!cycleDetected && completedSteps.length > 0) {
    const canReachCompleted = new Set<string>(
      completedSteps.map((s) => s.id)
    );
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const step of normalizedSteps) {
        if (canReachCompleted.has(step.id)) continue;
        if (step.next_step_ids.some((nextId) => canReachCompleted.has(nextId))) {
          canReachCompleted.add(step.id);
          progressed = true;
        }
      }
    }

    for (const step of normalizedSteps) {
      if (!canReachCompleted.has(step.id)) {
        errors.push({
          code: 'DEAD_END_STEP',
          step_id: step.id,
          field: 'next_step_ids',
          message: `Step "${step.id}" has no valid path to a completed step.`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, config: null, errors };
  }

  const kdsEnabled =
    typeof raw.kds_enabled === 'boolean'
      ? raw.kds_enabled
      : normalizedSteps.some((s) => s.show_on_kds);

  return {
    valid: true,
    config: {
      template_id: templateId,
      kds_enabled: kdsEnabled,
      start_step_id: startStepId,
      steps: normalizedSteps,
    },
    errors: [],
  };
}

export function resolveShopOrderWorkflowConfig(
  themeOrWorkflow?: ShopThemeConfig | ShopOrderWorkflowConfig | null
): ShopOrderWorkflowConfig {
  if (!themeOrWorkflow || !isPlainObject(themeOrWorkflow)) {
    return getBuiltInOrderWorkflowTemplate('classic_kitchen');
  }

  const candidate =
    'orderWorkflow' in themeOrWorkflow &&
    isPlainObject(themeOrWorkflow.orderWorkflow)
      ? themeOrWorkflow.orderWorkflow
      : 'steps' in themeOrWorkflow && 'start_step_id' in themeOrWorkflow
        ? themeOrWorkflow
        : null;

  if (!candidate) {
    return getBuiltInOrderWorkflowTemplate('classic_kitchen');
  }

  const validation = validateOrderWorkflowConfig(candidate);
  return validation.valid
    ? validation.config
    : getBuiltInOrderWorkflowTemplate('classic_kitchen');
}

export function resolveOrderCurrentWorkflowStep(
  order: Pick<ShopOrder, 'status' | 'workflow_step_id'>,
  workflowConfig?: ShopOrderWorkflowConfig | ShopThemeConfig | null
): OrderWorkflowStepConfig | null {
  if (order.status === 'cancelled') {
    return null;
  }

  const config = resolveShopOrderWorkflowConfig(workflowConfig);
  const stepId =
    typeof order.workflow_step_id === 'string'
      ? order.workflow_step_id.trim()
      : '';

  if (stepId) {
    const matched = config.steps.find(
      (step) => step.id === stepId && step.stage === order.status
    );
    if (matched) return matched;
  }

  if (order.status === 'new') {
    const startStep = config.steps.find(
      (step) => step.id === config.start_step_id
    );
    if (startStep) return startStep;
  }

  const stageFallback = config.steps.find(
    (step) => step.stage === order.status
  );
  return stageFallback ?? null;
}

export function getAllowedNextWorkflowSteps(
  order: Pick<ShopOrder, 'status' | 'workflow_step_id'>,
  workflowConfig?: ShopOrderWorkflowConfig | ShopThemeConfig | null
): OrderWorkflowStepConfig[] {
  const config = resolveShopOrderWorkflowConfig(workflowConfig);
  const currentStep = resolveOrderCurrentWorkflowStep(order, config);
  if (!currentStep) return [];

  const stepMap = new Map(config.steps.map((s) => [s.id, s]));
  return currentStep.next_step_ids
    .map((id) => stepMap.get(id))
    .filter((step): step is OrderWorkflowStepConfig => Boolean(step));
}

export function resolveCompletedTerminalWorkflowStep(
  workflowConfig?: ShopOrderWorkflowConfig | ShopThemeConfig | null
): OrderWorkflowStepConfig {
  const config = resolveShopOrderWorkflowConfig(workflowConfig);
  const stepMap = new Map(config.steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  let curr = stepMap.get(config.start_step_id);

  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    if (curr.stage === 'completed') {
      return curr;
    }
    const nextId = curr.next_step_ids[0];
    curr = nextId ? stepMap.get(nextId) : undefined;
  }

  return (
    config.steps.find((s) => s.stage === 'completed') ??
    config.steps[config.steps.length - 1]
  );
}

export interface ResolveOrderWorkflowMutationParams {
  existingOrder: Pick<ShopOrder, 'status' | 'workflow_step_id'>;
  requestedStatus?: OrderStatus;
  requestedWorkflowStepId?: string | null;
  themeConfig?: ShopThemeConfig | null;
  hasOtherFieldMutations?: boolean;
}

export function resolveOrderWorkflowMutation(
  params: ResolveOrderWorkflowMutationParams
): {
  nextStatus: OrderStatus;
  nextWorkflowStepId: string | null;
} {
  const {
    existingOrder,
    requestedStatus,
    requestedWorkflowStepId,
    themeConfig,
    hasOtherFieldMutations = false,
  } = params;

  const hasRawStepId = requestedWorkflowStepId !== undefined;
  const trimmedStepId =
    typeof requestedWorkflowStepId === 'string'
      ? requestedWorkflowStepId.trim()
      : '';

  if (hasRawStepId && !trimmedStepId) {
    throw new Error(
      'INVALID_WORKFLOW_STEP: Mã bước quy trình (workflow_step_id) không hợp lệ.'
    );
  }

  if (requestedStatus === 'cancelled') {
    if (hasRawStepId) {
      throw new Error(
        'INVALID_WORKFLOW_TRANSITION: Không thể chuyển bước quy trình khi hủy đơn hàng.'
      );
    }
    return {
      nextStatus: 'cancelled',
      nextWorkflowStepId: existingOrder.workflow_step_id ?? null,
    };
  }

  if (existingOrder.status === 'cancelled') {
    if (hasRawStepId) {
      throw new Error(
        'INVALID_WORKFLOW_TRANSITION: Đơn hàng đã hủy không thể chuyển bước quy trình.'
      );
    }
    return {
      nextStatus: requestedStatus || existingOrder.status,
      nextWorkflowStepId: existingOrder.workflow_step_id ?? null,
    };
  }

  const hasConfiguredWorkflow = Boolean(
    themeConfig &&
      typeof themeConfig === 'object' &&
      'orderWorkflow' in themeConfig &&
      themeConfig.orderWorkflow !== undefined &&
      validateOrderWorkflowConfig(themeConfig.orderWorkflow).valid
  );
  const workflowConfig = resolveShopOrderWorkflowConfig(themeConfig);

  if (hasRawStepId) {
    const targetStep = workflowConfig.steps.find((s) => s.id === trimmedStepId);
    if (!targetStep) {
      throw new Error(
        `UNKNOWN_WORKFLOW_STEP: Bước quy trình "${trimmedStepId}" không tồn tại trong cấu hình của quán.`
      );
    }

    if (
      requestedStatus !== undefined &&
      requestedStatus !== targetStep.stage
    ) {
      throw new Error(
        `WORKFLOW_STAGE_MISMATCH: Trạng thái "${requestedStatus}" không khớp với giai đoạn "${targetStep.stage}" của bước "${targetStep.id}".`
      );
    }

    const currentStep = resolveOrderCurrentWorkflowStep(
      existingOrder,
      workflowConfig
    );
    if (!currentStep || !currentStep.next_step_ids.includes(targetStep.id)) {
      throw new Error(
        `INVALID_WORKFLOW_TRANSITION: Không thể chuyển trực tiếp từ bước "${currentStep?.id || existingOrder.status}" sang bước "${targetStep.id}".`
      );
    }

    if (
      WORKFLOW_STAGE_RANK[targetStep.stage] <
      WORKFLOW_STAGE_RANK[currentStep.stage]
    ) {
      throw new Error(
        `INVALID_STATE_TRANSITION: Không thể chuyển ngược giai đoạn từ "${currentStep.stage}" về "${targetStep.stage}".`
      );
    }

    return {
      nextStatus: targetStep.stage,
      nextWorkflowStepId: targetStep.id,
    };
  }

  if (requestedStatus === undefined) {
    return {
      nextStatus: existingOrder.status,
      nextWorkflowStepId: existingOrder.workflow_step_id ?? null,
    };
  }

  if (existingOrder.status === 'completed' && requestedStatus === 'new') {
    throw new Error(
      'INVALID_STATE_TRANSITION: Đơn hàng đã hoàn tất không thể chuyển ngược về trạng thái mới.'
    );
  }

  if (hasConfiguredWorkflow) {
    const currentStep = resolveOrderCurrentWorkflowStep(
      existingOrder,
      workflowConfig
    );
    const allowedNextSteps = getAllowedNextWorkflowSteps(
      existingOrder,
      workflowConfig
    );
    const matchingNextSteps = allowedNextSteps.filter(
      (s) => s.stage === requestedStatus
    );

    if (matchingNextSteps.length === 1) {
      return {
        nextStatus: matchingNextSteps[0].stage,
        nextWorkflowStepId: matchingNextSteps[0].id,
      };
    }

    if (matchingNextSteps.length > 1) {
      throw new Error(
        `AMBIGUOUS_WORKFLOW_TRANSITION: Có nhiều bước tiếp theo ứng với trạng thái "${requestedStatus}" (${matchingNextSteps.map((s) => s.id).join(', ')}). Vui lòng chọn bước quy trình cụ thể.`
      );
    }

    if (requestedStatus === existingOrder.status && hasOtherFieldMutations) {
      return {
        nextStatus: existingOrder.status,
        nextWorkflowStepId:
          existingOrder.workflow_step_id ?? currentStep?.id ?? null,
      };
    }

    throw new Error(
      `INVALID_WORKFLOW_TRANSITION: Không thể chuyển trực tiếp từ bước "${currentStep?.id || existingOrder.status}" sang trạng thái "${requestedStatus}" theo quy trình của quán.`
    );
  }

  return {
    nextStatus: requestedStatus,
    nextWorkflowStepId: requestedStatus,
  };
}

export type OrderWorkflowTransitionResult =
  | {
      valid: true;
      currentStep: OrderWorkflowStepConfig;
      nextStep: OrderWorkflowStepConfig;
      nextStatus: OrderStatus;
    }
  | {
      valid: false;
      code:
        | 'ORDER_CANCELLED'
        | 'UNKNOWN_WORKFLOW_STEP'
        | 'INVALID_WORKFLOW_TRANSITION'
        | 'STAGE_REGRESSION_FORBIDDEN';
      message: string;
    };

export function validateOrderWorkflowTransition(params: {
  order: Pick<ShopOrder, 'status' | 'workflow_step_id'>;
  nextStepId: string;
  workflowConfig?: ShopOrderWorkflowConfig | null;
}): OrderWorkflowTransitionResult {
  const { order, nextStepId, workflowConfig } = params;
  if (order.status === 'cancelled') {
    return {
      valid: false,
      code: 'ORDER_CANCELLED',
      message: 'Cancelled orders cannot transition through fulfillment workflow steps.',
    };
  }

  const config = resolveShopOrderWorkflowConfig(workflowConfig);
  const currentStep = resolveOrderCurrentWorkflowStep(order, config);
  const trimmedTargetId =
    typeof nextStepId === 'string' ? nextStepId.trim() : '';
  const targetStep = config.steps.find((s) => s.id === trimmedTargetId);

  if (!currentStep || !targetStep) {
    return {
      valid: false,
      code: 'UNKNOWN_WORKFLOW_STEP',
      message: `Workflow step "${trimmedTargetId}" does not exist in the shop workflow configuration.`,
    };
  }

  if (!currentStep.next_step_ids.includes(targetStep.id)) {
    return {
      valid: false,
      code: 'INVALID_WORKFLOW_TRANSITION',
      message: `Transition from "${currentStep.id}" to "${targetStep.id}" is not allowed by the shop workflow.`,
    };
  }

  if (
    WORKFLOW_STAGE_RANK[targetStep.stage] <
    WORKFLOW_STAGE_RANK[currentStep.stage]
  ) {
    return {
      valid: false,
      code: 'STAGE_REGRESSION_FORBIDDEN',
      message: `Transition from "${currentStep.id}" (${currentStep.stage}) to "${targetStep.id}" (${targetStep.stage}) regresses canonical order status.`,
    };
  }

  return {
    valid: true,
    currentStep,
    nextStep: targetStep,
    nextStatus: targetStep.stage,
  };
}

export interface StaffOrderWorkflowAction {
  stepId: string;
  stage: OrderWorkflowStepStage;
  actionLabel: string;
  stepLabel: string;
  suggestLabelPrint: boolean;
  patchPayload: {
    status: OrderWorkflowStepStage;
    workflow_step_id: string;
  };
}

const DEFAULT_CANONICAL_ORDER_STATUS_LABELS: Record<
  OrderStatus,
  { vi: string; en: string }
> = {
  new: { vi: 'Mới nhận', en: 'New' },
  preparing: { vi: 'Đang làm', en: 'Preparing' },
  completed: { vi: 'Đã phục vụ', en: 'Completed' },
  cancelled: { vi: 'Đã hủy', en: 'Cancelled' },
};

export function resolveStaffOrderStepLabel(
  order: Pick<ShopOrder, 'status' | 'workflow_step_id'>,
  workflowOrTheme?: ShopOrderWorkflowConfig | ShopThemeConfig | null,
  locale: SupportedLocale = 'vi',
  fallbackCanonicalLabel?: string
): string {
  const fallback =
    fallbackCanonicalLabel?.trim() ||
    (locale === 'en'
      ? DEFAULT_CANONICAL_ORDER_STATUS_LABELS[order.status]?.en
      : DEFAULT_CANONICAL_ORDER_STATUS_LABELS[order.status]?.vi) ||
    order.status;

  if (order.status === 'cancelled') {
    return fallback;
  }

  const config = resolveShopOrderWorkflowConfig(workflowOrTheme);
  const rawStepId =
    typeof order.workflow_step_id === 'string'
      ? order.workflow_step_id.trim()
      : '';

  if (rawStepId) {
    const exactMatch = config.steps.find(
      (step) => step.id === rawStepId && step.stage === order.status
    );
    if (exactMatch) {
      return resolveWorkflowLocalizedText(exactMatch.label_i18n, locale) || fallback;
    }
    const isCanonicalLegacyStepId =
      rawStepId === 'new' ||
      rawStepId === 'preparing' ||
      rawStepId === 'completed';
    if (!isCanonicalLegacyStepId) {
      return fallback;
    }
  }

  if (order.status === 'new') {
    const startStep = config.steps.find(
      (step) => step.id === config.start_step_id && step.stage === 'new'
    );
    if (startStep) {
      return resolveWorkflowLocalizedText(startStep.label_i18n, locale) || fallback;
    }
  }

  const stageMatches = config.steps.filter((step) => step.stage === order.status);
  if (stageMatches.length === 1) {
    return (
      resolveWorkflowLocalizedText(stageMatches[0].label_i18n, locale) || fallback
    );
  }

  return fallback;
}

export function getStaffOrderWorkflowActions(
  order: Pick<ShopOrder, 'status' | 'workflow_step_id'>,
  workflowOrTheme?: ShopOrderWorkflowConfig | ShopThemeConfig | null,
  locale: SupportedLocale = 'vi'
): StaffOrderWorkflowAction[] {
  if (order.status === 'cancelled') {
    return [];
  }

  const config = resolveShopOrderWorkflowConfig(workflowOrTheme);
  const nextSteps = getAllowedNextWorkflowSteps(order, config);

  return nextSteps.map((nextStep) => {
    const stepLabel =
      resolveWorkflowLocalizedText(nextStep.label_i18n, locale) || nextStep.id;
    const actionLabel =
      resolveWorkflowLocalizedText(nextStep.action_label_i18n, locale) ||
      stepLabel;

    return {
      stepId: nextStep.id,
      stage: nextStep.stage,
      actionLabel,
      stepLabel,
      suggestLabelPrint: Boolean(nextStep.suggest_label_print),
      patchPayload: {
        status: nextStep.stage,
        workflow_step_id: nextStep.id,
      },
    };
  });
}
