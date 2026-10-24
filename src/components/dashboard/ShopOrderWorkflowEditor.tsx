'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Check,
  GitBranch,
  Loader2,
  Monitor,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { getAuthHeaders, isSuperAdmin } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { isShopOwnerMembership } from '@/lib/dashboard-nav';
import {
  MAX_WORKFLOW_LABEL_LENGTH,
  MAX_WORKFLOW_STEPS,
  MIN_WORKFLOW_STEPS,
  STEP_ID_PATTERN,
  cloneWorkflowConfig,
  getBuiltInOrderWorkflowTemplate,
  resolveShopOrderWorkflowConfig,
  resolveWorkflowLocalizedText,
  validateOrderWorkflowConfig,
  type OrderWorkflowValidationError,
} from '@/lib/order-workflow';
import type {
  OrderWorkflowStepConfig,
  OrderWorkflowStepStage,
  OrderWorkflowTemplateId,
  Profile,
  Shop,
  ShopMembership,
  ShopOrderWorkflowConfig,
} from '@/types/qlaok';

export interface WorkflowTemplateOptionMeta {
  id: OrderWorkflowTemplateId;
  titleVi: string;
  titleEn: string;
  summaryVi: string;
  summaryEn: string;
  badgeVi: string;
  badgeEn: string;
}

export const WORKFLOW_TEMPLATE_OPTIONS: readonly WorkflowTemplateOptionMeta[] = [
  {
    id: 'classic_kitchen',
    titleVi: 'Bếp truyền thống (KDS)',
    titleEn: 'Classic Kitchen (KDS)',
    summaryVi:
      'Mới chờ bếp → Đang chế biến → Hoàn tất phục vụ. Hiển thị trên màn hình bếp KDS.',
    summaryEn:
      'New for kitchen → Preparing → Completed. Visible on the Kitchen Display Screen (KDS).',
    badgeVi: '3 bước • Có KDS',
    badgeEn: '3 steps • KDS on',
  },
  {
    id: 'counter_bar_serve',
    titleVi: 'Thu ngân → Pha chế gần quầy → Phục vụ',
    titleEn: 'Counter → Nearby Bar → Serve',
    summaryVi:
      'Nhận đơn tại quầy → Đang pha chế (gợi ý in tem dán ly) → Đã bưng ra bàn. Không bắt buộc qua màn hình bếp.',
    summaryEn:
      'Counter received → Making at bar (suggests cup label print) → Served. No separate kitchen screen handoff.',
    badgeVi: '3 bước • Gợi ý in tem',
    badgeEn: '3 steps • Label print',
  },
  {
    id: 'simple_counter',
    titleVi: 'Quầy đơn giản (Giao ngay)',
    titleEn: 'Simple Counter (Direct Serve)',
    summaryVi:
      'Mới nhận tại quầy → Đã giao ngay. Phù hợp quầy bán nhanh, trao món trực tiếp.',
    summaryEn:
      'New at counter → Served directly. Ideal for quick-service counters.',
    badgeVi: '2 bước • Tối giản',
    badgeEn: '2 steps • Minimal',
  },
  {
    id: 'custom',
    titleVi: 'Tùy chỉnh sơ đồ (Custom)',
    titleEn: 'Custom Flowchart',
    summaryVi:
      'Tự thêm/bớt bước (2–8 bước), đổi nhãn song ngữ VI/EN và nối mũi tên chuyển bước theo quy trình riêng.',
    summaryEn:
      'Add/remove steps (2–8), customize VI/EN labels, and configure directed step connections.',
    badgeVi: '2–8 bước • Tùy biến',
    badgeEn: '2–8 steps • Custom',
  },
] as const;

const STAGE_ORDER: Record<OrderWorkflowStepStage, number> = {
  new: 0,
  preparing: 1,
  completed: 2,
};

export function canActorEditOrderWorkflow(
  membership?: Pick<ShopMembership, 'role' | 'permissions' | 'is_active'> | null,
  profile?: Partial<Pick<Profile, 'role' | 'is_admin' | 'email'>> | null,
  isAdminOverride?: boolean
): boolean {
  if (isAdminOverride === true) return true;
  if (isShopOwnerMembership(membership)) return true;
  if (profile && isSuperAdmin(profile as Profile)) return true;
  return false;
}

export function applyWorkflowTemplateSelection(
  currentConfig: ShopOrderWorkflowConfig,
  templateId: OrderWorkflowTemplateId
): ShopOrderWorkflowConfig {
  if (
    templateId === 'classic_kitchen' ||
    templateId === 'counter_bar_serve' ||
    templateId === 'simple_counter'
  ) {
    return getBuiltInOrderWorkflowTemplate(templateId);
  }
  const cloned = cloneWorkflowConfig(currentConfig);
  return {
    ...cloned,
    template_id: 'custom',
  };
}

export function setWorkflowKdsEnabled(
  config: ShopOrderWorkflowConfig,
  kdsEnabled: boolean
): ShopOrderWorkflowConfig {
  const cloned = cloneWorkflowConfig(config);
  return {
    ...cloned,
    template_id: 'custom',
    kds_enabled: Boolean(kdsEnabled),
  };
}

export function setWorkflowStartStep(
  config: ShopOrderWorkflowConfig,
  startStepId: string
): ShopOrderWorkflowConfig {
  const cloned = cloneWorkflowConfig(config);
  const trimmed = startStepId.trim();
  const targetStep = cloned.steps.find((step) => step.id === trimmed);

  if (!targetStep) {
    return {
      ...cloned,
      template_id: 'custom',
      start_step_id: trimmed,
    };
  }

  if (targetStep.stage === 'completed') {
    return cloned;
  }

  const oldStartStep =
    cloned.steps.find((step) => step.id === cloned.start_step_id) ||
    cloned.steps.find((step) => step.stage === 'new');

  if (!oldStartStep || oldStartStep.id === trimmed) {
    const updatedSteps = cloned.steps.map((step) => {
      if (step.id === trimmed) {
        return {
          ...step,
          stage: 'new' as OrderWorkflowStepStage,
        };
      }
      if (step.stage === 'new') {
        return {
          ...step,
          stage: 'preparing' as OrderWorkflowStepStage,
        };
      }
      return step;
    });

    return {
      ...cloned,
      template_id: 'custom',
      start_step_id: trimmed,
      steps: updatedSteps,
    };
  }

  const oldStartId = oldStartStep.id;
  const oldStartNext = oldStartStep.next_step_ids.filter(
    (id) => id !== trimmed && id !== oldStartId
  );
  const targetOldNext = targetStep.next_step_ids.filter(
    (id) => id !== oldStartId && id !== trimmed
  );
  const fallbackCompleted = cloned.steps.find((s) => s.stage === 'completed');

  const newStartNextIds = Array.from(
    new Set([oldStartId, ...oldStartNext])
  );
  const demotedOldStartNextIds =
    targetOldNext.length > 0
      ? Array.from(new Set([...targetOldNext, ...oldStartNext]))
      : oldStartNext.length > 0
        ? [...oldStartNext]
        : fallbackCompleted
          ? [fallbackCompleted.id]
          : [];

  const rewiredSteps = cloned.steps.map((step) => {
    if (step.id === trimmed) {
      return {
        ...step,
        stage: 'new' as OrderWorkflowStepStage,
        next_step_ids: newStartNextIds,
      };
    }
    if (step.id === oldStartId) {
      return {
        ...step,
        stage: 'preparing' as OrderWorkflowStepStage,
        next_step_ids: demotedOldStartNextIds,
      };
    }
    if (step.next_step_ids.includes(trimmed)) {
      const redirected = step.next_step_ids
        .map((id) => (id === trimmed ? oldStartId : id))
        .filter((id) => id !== step.id);
      return {
        ...step,
        next_step_ids: Array.from(new Set(redirected)),
      };
    }
    return step;
  });

  const newStartObj = rewiredSteps.find((s) => s.id === trimmed)!;
  const remainingSteps = rewiredSteps.filter((s) => s.id !== trimmed);

  return {
    ...cloned,
    template_id: 'custom',
    start_step_id: trimmed,
    steps: [newStartObj, ...remainingSteps],
  };
}

export function generateNextWorkflowStepId(
  config: ShopOrderWorkflowConfig,
  stage: 'preparing' | 'completed' = 'preparing'
): string {
  const existingIds = new Set(config.steps.map((s) => s.id));
  const prefix = stage === 'completed' ? 'served_step' : 'prep_step';
  for (let idx = 1; idx <= 99; idx += 1) {
    const candidate = `${prefix}_${idx}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}_${Date.now().toString(36).slice(-6)}`;
}

export function addWorkflowStep(
  config: ShopOrderWorkflowConfig,
  options?: {
    id?: string;
    stage?: 'preparing' | 'completed';
    labelVi?: string;
    labelEn?: string;
    actionLabelVi?: string;
    actionLabelEn?: string;
    customerLabelVi?: string;
    customerLabelEn?: string;
    show_on_kds?: boolean;
    suggest_label_print?: boolean;
  }
): ShopOrderWorkflowConfig {
  const cloned = cloneWorkflowConfig(config);
  if (cloned.steps.length >= MAX_WORKFLOW_STEPS) {
    return cloned;
  }

  const stage: 'preparing' | 'completed' =
    options?.stage === 'completed' ? 'completed' : 'preparing';
  const existingIds = new Set(cloned.steps.map((s) => s.id));
  const requestedId = options?.id
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  const stepId =
    requestedId &&
    STEP_ID_PATTERN.test(requestedId) &&
    !existingIds.has(requestedId)
      ? requestedId
      : generateNextWorkflowStepId(cloned, stage);

  const stepNumber = cloned.steps.length + 1;
  const defaultVi =
    stage === 'completed'
      ? `Hoàn tất bước ${stepNumber}`
      : `Bước pha chế / xử lý ${stepNumber}`;
  const defaultEn =
    stage === 'completed'
      ? `Completed step ${stepNumber}`
      : `Prep / service step ${stepNumber}`;

  const labelVi = (options?.labelVi ?? defaultVi).trim() || defaultVi;
  const labelEn = (options?.labelEn ?? defaultEn).trim() || defaultEn;
  const actionVi =
    (
      options?.actionLabelVi ??
      (stage === 'completed' ? `Hoàn tất (${labelVi})` : `Chuyển sang ${labelVi}`)
    ).trim() || labelVi;
  const actionEn =
    (
      options?.actionLabelEn ??
      (stage === 'completed' ? `Complete (${labelEn})` : `Move to ${labelEn}`)
    ).trim() || labelEn;
  const customerVi = (options?.customerLabelVi ?? labelVi).trim() || labelVi;
  const customerEn = (options?.customerLabelEn ?? labelEn).trim() || labelEn;

  const completedSteps = cloned.steps.filter((s) => s.stage === 'completed');
  const firstCompletedId = completedSteps[0]?.id;

  const newStep: OrderWorkflowStepConfig = {
    id: stepId,
    stage,
    label_i18n: { vi: labelVi, en: labelEn },
    action_label_i18n: { vi: actionVi, en: actionEn },
    customer_label_i18n: { vi: customerVi, en: customerEn },
    show_on_kds:
      options?.show_on_kds !== undefined
        ? Boolean(options.show_on_kds)
        : stage === 'preparing'
          ? cloned.kds_enabled
          : false,
    suggest_label_print: Boolean(options?.suggest_label_print),
    next_step_ids:
      stage === 'preparing' && firstCompletedId ? [firstCompletedId] : [],
  };

  if (stage === 'completed') {
    const updatedSteps = cloned.steps.map((step) => {
      if (step.stage !== 'completed') {
        const hasCompletedTarget = step.next_step_ids.some((id) =>
          completedSteps.some((c) => c.id === id)
        );
        if (hasCompletedTarget && !step.next_step_ids.includes(stepId)) {
          return {
            ...step,
            next_step_ids: [...step.next_step_ids, stepId],
          };
        }
      }
      return step;
    });
    return {
      ...cloned,
      template_id: 'custom',
      steps: [...updatedSteps, newStep],
    };
  }

  // Insert preparing step right before the first completed step, and wire the preceding non-completed step to it
  const firstCompletedIndex = cloned.steps.findIndex(
    (s) => s.stage === 'completed'
  );
  const insertIndex =
    firstCompletedIndex >= 0 ? firstCompletedIndex : cloned.steps.length;

  const prevNonCompleted = [...cloned.steps.slice(0, insertIndex)]
    .reverse()
    .find((s) => s.stage !== 'completed');

  const updatedSteps = cloned.steps.map((step) => {
    if (prevNonCompleted && step.id === prevNonCompleted.id) {
      const filteredNext = firstCompletedId
        ? step.next_step_ids.filter((id) => id !== firstCompletedId)
        : [...step.next_step_ids];
      const nextIds = filteredNext.includes(stepId)
        ? filteredNext
        : [...filteredNext, stepId];
      return {
        ...step,
        next_step_ids: nextIds,
      };
    }
    return step;
  });

  const nextStepsArray = [
    ...updatedSteps.slice(0, insertIndex),
    newStep,
    ...updatedSteps.slice(insertIndex),
  ];

  return {
    ...cloned,
    template_id: 'custom',
    steps: nextStepsArray,
  };
}

export function canRemoveWorkflowStep(
  config: ShopOrderWorkflowConfig,
  stepId: string
): { allowed: boolean; reasonVi?: string; reasonEn?: string } {
  if (config.steps.length <= MIN_WORKFLOW_STEPS) {
    return {
      allowed: false,
      reasonVi: `Quy trình cần tối thiểu ${MIN_WORKFLOW_STEPS} bước.`,
      reasonEn: `Workflow requires at least ${MIN_WORKFLOW_STEPS} steps.`,
    };
  }
  const target = config.steps.find((s) => s.id === stepId);
  if (!target) {
    return {
      allowed: false,
      reasonVi: 'Không tìm thấy bước cần xóa.',
      reasonEn: 'Step not found.',
    };
  }
  if (target.id === config.start_step_id || target.stage === 'new') {
    return {
      allowed: false,
      reasonVi: 'Không thể xóa bước bắt đầu nhận đơn (stage = new).',
      reasonEn: 'Cannot delete the start order-receipt step (stage = new).',
    };
  }
  if (target.stage === 'completed') {
    const completedCount = config.steps.filter(
      (s) => s.stage === 'completed'
    ).length;
    if (completedCount <= 1) {
      return {
        allowed: false,
        reasonVi:
          'Quy trình phải có ít nhất 1 bước kết thúc hoàn tất phục vụ (completed).',
        reasonEn:
          'Workflow must keep at least 1 terminal completed step.',
      };
    }
  }
  return { allowed: true };
}

export function removeWorkflowStep(
  config: ShopOrderWorkflowConfig,
  stepIdToRemove: string
): {
  config: ShopOrderWorkflowConfig;
  removed: boolean;
  reasonVi?: string;
  reasonEn?: string;
} {
  const check = canRemoveWorkflowStep(config, stepIdToRemove);
  if (!check.allowed) {
    return {
      config: cloneWorkflowConfig(config),
      removed: false,
      reasonVi: check.reasonVi,
      reasonEn: check.reasonEn,
    };
  }

  const cloned = cloneWorkflowConfig(config);
  const removedStep = cloned.steps.find((s) => s.id === stepIdToRemove)!;
  const remainingSteps = cloned.steps.filter((s) => s.id !== stepIdToRemove);
  const remainingById = new Map(remainingSteps.map((s) => [s.id, s]));
  const fallbackCompleted = remainingSteps.find((s) => s.stage === 'completed');

  const cleanedSteps = remainingSteps.map((step) => {
    if (!step.next_step_ids.includes(stepIdToRemove)) {
      return step;
    }
    const withoutRemoved = step.next_step_ids.filter(
      (id) => id !== stepIdToRemove && remainingById.has(id)
    );
    if (withoutRemoved.length > 0 || step.stage === 'completed') {
      return {
        ...step,
        next_step_ids: withoutRemoved,
      };
    }

    // Bridge through removedStep.next_step_ids so no dangling reference or accidental dead-end is left
    const bridged = removedStep.next_step_ids.filter((candidateId) => {
      const target = remainingById.get(candidateId);
      if (!target || target.id === step.id) return false;
      return STAGE_ORDER[target.stage] >= STAGE_ORDER[step.stage];
    });

    if (bridged.length > 0) {
      return {
        ...step,
        next_step_ids: Array.from(new Set(bridged)),
      };
    }

    if (fallbackCompleted && fallbackCompleted.id !== step.id) {
      return {
        ...step,
        next_step_ids: [fallbackCompleted.id],
      };
    }

    return {
      ...step,
      next_step_ids: [],
    };
  });

  return {
    config: {
      ...cloned,
      template_id: 'custom',
      steps: cleanedSteps,
    },
    removed: true,
  };
}

export interface WorkflowStepEditPatch {
  stage?: OrderWorkflowStepStage;
  labelVi?: string;
  labelEn?: string;
  actionLabelVi?: string;
  actionLabelEn?: string;
  customerLabelVi?: string;
  customerLabelEn?: string;
  show_on_kds?: boolean;
  suggest_label_print?: boolean;
}

export function updateWorkflowStep(
  config: ShopOrderWorkflowConfig,
  stepId: string,
  patch: WorkflowStepEditPatch
): ShopOrderWorkflowConfig {
  const cloned = cloneWorkflowConfig(config);
  const completedFallback = cloned.steps.find(
    (s) => s.stage === 'completed' && s.id !== stepId
  );

  const updatedSteps = cloned.steps.map((step) => {
    if (step.id !== stepId) return step;

    const nextStage: OrderWorkflowStepStage =
      step.id === cloned.start_step_id
        ? 'new'
        : patch.stage &&
            (patch.stage === 'preparing' || patch.stage === 'completed')
          ? patch.stage
          : step.stage;

    const nextLabelVi =
      patch.labelVi !== undefined ? patch.labelVi : step.label_i18n.vi || '';
    const nextLabelEn =
      patch.labelEn !== undefined
        ? patch.labelEn
        : step.label_i18n.en ?? step.label_i18n.vi ?? '';

    const nextActionVi =
      patch.actionLabelVi !== undefined
        ? patch.actionLabelVi
        : step.action_label_i18n.vi || '';
    const nextActionEn =
      patch.actionLabelEn !== undefined
        ? patch.actionLabelEn
        : step.action_label_i18n.en ?? step.action_label_i18n.vi ?? '';

    const currentCustomer = step.customer_label_i18n || step.label_i18n;
    const nextCustomerVi =
      patch.customerLabelVi !== undefined
        ? patch.customerLabelVi
        : currentCustomer.vi || '';
    const nextCustomerEn =
      patch.customerLabelEn !== undefined
        ? patch.customerLabelEn
        : currentCustomer.en ?? currentCustomer.vi ?? '';

    let nextStepIds = [...step.next_step_ids];
    if (nextStage === 'completed') {
      nextStepIds = [];
    } else if (
      step.stage === 'completed' &&
      nextStage === 'preparing' &&
      nextStepIds.length === 0 &&
      completedFallback
    ) {
      nextStepIds = [completedFallback.id];
    }

    return {
      ...step,
      stage: nextStage,
      label_i18n: {
        vi: nextLabelVi,
        en: nextLabelEn,
      },
      action_label_i18n: {
        vi: nextActionVi,
        en: nextActionEn,
      },
      customer_label_i18n: {
        vi: nextCustomerVi,
        en: nextCustomerEn,
      },
      show_on_kds:
        patch.show_on_kds !== undefined
          ? Boolean(patch.show_on_kds)
          : step.show_on_kds,
      suggest_label_print:
        patch.suggest_label_print !== undefined
          ? Boolean(patch.suggest_label_print)
          : Boolean(step.suggest_label_print),
      next_step_ids: nextStepIds,
    };
  });

  return {
    ...cloned,
    template_id: 'custom',
    steps: updatedSteps,
  };
}

export function getEligibleNextStepTargets(
  config: ShopOrderWorkflowConfig,
  fromStepId: string
): OrderWorkflowStepConfig[] {
  const fromStep = config.steps.find((s) => s.id === fromStepId);
  if (!fromStep || fromStep.stage === 'completed') {
    return [];
  }
  return config.steps.filter(
    (candidate) =>
      candidate.id !== fromStep.id &&
      STAGE_ORDER[candidate.stage] >= STAGE_ORDER[fromStep.stage]
  );
}

export function toggleWorkflowStepConnection(
  config: ShopOrderWorkflowConfig,
  fromStepId: string,
  toStepId: string,
  enabled?: boolean
): ShopOrderWorkflowConfig {
  if (fromStepId === toStepId) {
    return cloneWorkflowConfig(config);
  }
  const cloned = cloneWorkflowConfig(config);
  const targetExists = cloned.steps.some((s) => s.id === toStepId);
  if (!targetExists) {
    return cloned;
  }

  const validOrder = new Map(cloned.steps.map((s, idx) => [s.id, idx]));

  const updatedSteps = cloned.steps.map((step) => {
    if (step.id !== fromStepId) return step;
    const currentlyConnected = step.next_step_ids.includes(toStepId);
    const shouldConnect =
      enabled !== undefined ? Boolean(enabled) : !currentlyConnected;

    const nextIds = shouldConnect
      ? currentlyConnected
        ? [...step.next_step_ids]
        : [...step.next_step_ids, toStepId]
      : step.next_step_ids.filter((id) => id !== toStepId);

    nextIds.sort(
      (a, b) => (validOrder.get(a) ?? 999) - (validOrder.get(b) ?? 999)
    );

    return {
      ...step,
      next_step_ids: nextIds,
    };
  });

  return {
    ...cloned,
    template_id: 'custom',
    steps: updatedSteps,
  };
}

export function formatWorkflowValidationError(
  error: OrderWorkflowValidationError,
  config: ShopOrderWorkflowConfig,
  locale: 'vi' | 'en' = 'vi'
): string {
  const isEn = locale === 'en';
  const step = error.step_id
    ? config.steps.find((s) => s.id === error.step_id)
    : undefined;
  const stepTitle = step
    ? resolveWorkflowLocalizedText(step.label_i18n, locale) || step.id
    : error.step_id || '';
  const stepRef = stepTitle ? `"${stepTitle}"` : '';

  switch (error.code) {
    case 'MISSING_STEP_LABEL':
      return isEn
        ? `Step ${stepRef} requires a non-empty VI or EN name.`
        : `Bước ${stepRef} cần có tên hiển thị (Tiếng Việt hoặc Tiếng Anh).`;
    case 'LABEL_TOO_LONG':
      return isEn
        ? `Text on step ${stepRef} cannot exceed ${MAX_WORKFLOW_LABEL_LENGTH} characters.`
        : `Nhãn của bước ${stepRef} không được vượt quá ${MAX_WORKFLOW_LABEL_LENGTH} ký tự.`;
    case 'UNSAFE_STEP_LABEL':
      return isEn
        ? `Text on step ${stepRef} cannot contain HTML tags (< or >) or control characters.`
        : `Nhãn của bước ${stepRef} không được chứa ký tự HTML (<, >) hoặc ký tự điều khiển.`;
    case 'DEAD_END_STEP':
      return isEn
        ? `Step ${stepRef} has no outgoing connection to a completed step. Select at least one next step.`
        : `Bước ${stepRef} chưa nối tới bước hoàn tất. Vui lòng chọn ít nhất 1 bước tiếp theo.`;
    case 'UNREACHABLE_STEP':
      return isEn
        ? `Step ${stepRef} is not connected from the start step. Connect a previous step to ${stepRef}.`
        : `Bước ${stepRef} chưa có mũi tên nào dẫn tới từ bước bắt đầu. Hãy nối một bước trước đó tới ${stepRef}.`;
    case 'WORKFLOW_CYCLE_DETECTED':
      return isEn
        ? 'Workflow contains a loop/cycle between steps. Connections must move forward toward completion.'
        : 'Sơ đồ quy trình đang có vòng lặp giữa các bước. Các kết nối phải đi tiến về bước hoàn tất.';
    case 'STAGE_REGRESSION_EDGE':
      return isEn
        ? `Step ${stepRef} connects backward to an earlier stage, which is not allowed.`
        : `Bước ${stepRef} đang nối lùi về giai đoạn trước (không hợp lệ).`;
    case 'MISSING_TERMINAL_STEP':
      return isEn
        ? 'Workflow must include at least one terminal Completed step.'
        : 'Quy trình bắt buộc có ít nhất 1 bước kết thúc ở giai đoạn Hoàn tất (completed).';
    case 'TERMINAL_STEP_HAS_OUTGOING_EDGES':
      return isEn
        ? `Completed step ${stepRef} is a terminal step and cannot connect to further steps.`
        : `Bước hoàn tất ${stepRef} là điểm kết thúc nên không được nối sang bước tiếp theo.`;
    case 'MULTIPLE_NEW_STAGE_STEPS':
    case 'START_STEP_MUST_BE_NEW_STAGE':
    case 'INVALID_START_STEP':
      return isEn
        ? 'Workflow must have exactly one start step in the "New" stage.'
        : 'Quy trình phải có đúng 1 bước bắt đầu ở giai đoạn "Mới nhận" (stage = new).';
    case 'TOO_FEW_STEPS':
      return isEn
        ? `Workflow requires at least ${MIN_WORKFLOW_STEPS} steps.`
        : `Quy trình cần tối thiểu ${MIN_WORKFLOW_STEPS} bước.`;
    case 'TOO_MANY_STEPS':
      return isEn
        ? `Workflow supports at most ${MAX_WORKFLOW_STEPS} steps.`
        : `Quy trình hỗ trợ tối đa ${MAX_WORKFLOW_STEPS} bước.`;
    case 'UNKNOWN_NEXT_STEP':
    case 'SELF_LOOP_EDGE':
      return isEn
        ? `Step ${stepRef} has an invalid next-step reference.`
        : `Bước ${stepRef} có kết nối bước tiếp theo không hợp lệ.`;
    default:
      return error.message;
  }
}

export function buildOrderWorkflowPatchPayload(
  shopId: string,
  workflow: ShopOrderWorkflowConfig
): {
  id: string;
  theme_config: {
    orderWorkflow: ShopOrderWorkflowConfig;
  };
} {
  return {
    id: shopId,
    theme_config: {
      orderWorkflow: workflow,
    },
  };
}

export type SaveShopOrderWorkflowResult =
  | {
      ok: true;
      shop: Shop;
      workflow: ShopOrderWorkflowConfig;
    }
  | {
      ok: false;
      error: string;
      validationErrors?: OrderWorkflowValidationError[];
    };

export async function saveShopOrderWorkflowConfig(params: {
  shopId: string;
  draft: ShopOrderWorkflowConfig;
  locale?: 'vi' | 'en';
  fetchImpl?: typeof fetch;
  authHeaders?: Record<string, string>;
  onUpdateActiveShop?: (shop: Shop) => void;
  onRefreshDashboard?: () => Promise<void>;
}): Promise<SaveShopOrderWorkflowResult> {
  const locale = params.locale || 'vi';
  const isEn = locale === 'en';

  if (!params.shopId || !params.shopId.trim()) {
    return {
      ok: false,
      error: isEn ? 'Missing store ID.' : 'Thiếu mã cửa hàng.',
    };
  }

  const validation = validateOrderWorkflowConfig(params.draft);
  if (!validation.valid || !validation.config) {
    const firstErr = validation.errors[0];
    return {
      ok: false,
      error: firstErr
        ? formatWorkflowValidationError(firstErr, params.draft, locale)
        : isEn
          ? 'Invalid order workflow configuration.'
          : 'Cấu hình quy trình đơn hàng chưa hợp lệ.',
      validationErrors: validation.errors,
    };
  }

  const payload = buildOrderWorkflowPatchPayload(
    params.shopId,
    validation.config
  );
  const fetcher = params.fetchImpl || globalThis.fetch;

  try {
    const res = await fetcher('/api/shops', {
      method: 'PATCH',
      headers:
        params.authHeaders ||
        getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => ({}))) as {
      shop?: Shop;
      error?: string;
      errors?: OrderWorkflowValidationError[];
    };

    if (
      !res.ok ||
      !data?.shop ||
      !data.shop.id ||
      data.shop.id !== params.shopId
    ) {
      return {
        ok: false,
        error:
          data?.error ||
          (isEn
            ? `Could not save order workflow (HTTP ${res.status}).`
            : `Không thể lưu quy trình đơn hàng (HTTP ${res.status}).`),
        ...(Array.isArray(data?.errors)
          ? { validationErrors: data.errors }
          : {}),
      };
    }

    const persistedValidation = validateOrderWorkflowConfig(
      data.shop.theme_config?.orderWorkflow
    );
    if (!persistedValidation.valid || !persistedValidation.config) {
      return {
        ok: false,
        error:
          data?.error ||
          (isEn
            ? 'Server response did not include the saved order workflow.'
            : 'Phản hồi máy chủ không chứa cấu hình quy trình đơn hàng đã lưu.'),
      };
    }

    params.onUpdateActiveShop?.(data.shop);

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({
          type: 'shop_updated',
          shopId: params.shopId,
          shop: data.shop,
        });
        bc.close();
      } catch {
        // Ignore BroadcastChannel errors in restricted browsers
      }
    }

    if (params.onRefreshDashboard) {
      try {
        await params.onRefreshDashboard();
      } catch {
        // Keep saved DB result even if background refresh fails
      }
    }

    return {
      ok: true,
      shop: data.shop,
      workflow: persistedValidation.config,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : isEn
            ? 'Network error while saving order workflow.'
            : 'Lỗi kết nối khi lưu quy trình đơn hàng.',
    };
  }
}

export interface ShopOrderWorkflowEditorProps {
  shop?: Shop | null;
  membership?: Pick<ShopMembership, 'role' | 'permissions' | 'is_active'> | null;
  profile?: Pick<Profile, 'role' | 'is_admin' | 'email'> | null;
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
  initialDraftOverride?: ShopOrderWorkflowConfig;
  selectedStepIdOverride?: string | null;
  errorOverride?: string | null;
  noticeOverride?: string | null;
  savingOverride?: boolean;
  onUpdateActiveShop?: (shop: Shop) => void;
  onRefreshDashboard?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}

/**
 * Merchant Order Workflow Editor mounted in Dashboard > Settings.
 * Rendered inside the Settings page <form>, so every <button> uses type="button"
 * and Enter on inputs is intercepted to prevent submitting the outer settings form.
 */
export function ShopOrderWorkflowEditor(props: ShopOrderWorkflowEditorProps) {
  const dashboard = useDashboard();
  const appI18n = useAppI18n();

  const activeShop = props.shop !== undefined ? props.shop : dashboard.activeShop;
  const activeMembership =
    props.membership !== undefined
      ? props.membership
      : dashboard.activeMembership;
  const activeProfile =
    props.profile !== undefined ? props.profile : dashboard.profile;
  const updateActiveShop =
    props.onUpdateActiveShop || dashboard.updateActiveShop;
  const refreshDashboard =
    props.onRefreshDashboard || dashboard.refreshDashboard;

  const effectiveLocale: 'vi' | 'en' =
    props.locale || (appI18n?.locale === 'en' ? 'en' : 'vi');
  const isEn = effectiveLocale === 'en';
  const tx = useMemo(
    () => (viText: string, enText: string) => (isEn ? enText : viText),
    [isEn]
  );

  const baseId = useId();

  const persistedWorkflow = useMemo(
    () => resolveShopOrderWorkflowConfig(activeShop?.theme_config),
    [activeShop?.theme_config]
  );

  const [draft, setDraft] = useState<ShopOrderWorkflowConfig>(() =>
    props.initialDraftOverride
      ? cloneWorkflowConfig(props.initialDraftOverride)
      : cloneWorkflowConfig(persistedWorkflow)
  );
  const [selectedStepId, setSelectedStepId] = useState<string>(() => {
    const initial =
      props.selectedStepIdOverride ||
      (props.initialDraftOverride || persistedWorkflow).start_step_id;
    return initial;
  });
  const [saving, setSaving] = useState(Boolean(props.savingOverride));
  const [errorMsg, setErrorMsg] = useState<string | null>(
    props.errorOverride ?? null
  );
  const [noticeMsg, setNoticeMsg] = useState<string | null>(
    props.noticeOverride ?? null
  );

  const shopId = activeShop?.id ?? '';
  const serializedPersistedWorkflow = useMemo(
    () => JSON.stringify(persistedWorkflow),
    [persistedWorkflow]
  );

  useEffect(() => {
    if (props.initialDraftOverride) return;
    const nextConfig = resolveShopOrderWorkflowConfig(activeShop?.theme_config);
    setDraft(cloneWorkflowConfig(nextConfig));
    setSelectedStepId((prev) =>
      nextConfig.steps.some((s) => s.id === prev)
        ? prev
        : nextConfig.start_step_id
    );
    setErrorMsg(null);
    setNoticeMsg(null);
    // Synchronize only when shopId or the serialized persisted workflow actually changes,
    // not when activeShop.theme_config gets a new object reference with identical workflow data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, serializedPersistedWorkflow, props.initialDraftOverride]);

  if (!activeShop) return null;

  const canEdit = canActorEditOrderWorkflow(
    activeMembership,
    activeProfile,
    props.isAdmin
  );

  const validation = validateOrderWorkflowConfig(draft);
  const localizedValidationErrors = validation.valid
    ? []
    : validation.errors.map((err) =>
        formatWorkflowValidationError(err, draft, effectiveLocale)
      );

  const selectedStep =
    draft.steps.find((s) => s.id === selectedStepId) || draft.steps[0] || null;
  const stepMap = new Map(draft.steps.map((s) => [s.id, s]));

  const isDirty =
    JSON.stringify(draft) !== JSON.stringify(persistedWorkflow);

  const preventFormSubmitOnEnter = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  const handleSelectTemplate = (templateId: OrderWorkflowTemplateId) => {
    if (!canEdit || saving) return;
    const next = applyWorkflowTemplateSelection(draft, templateId);
    setDraft(next);
    if (!next.steps.some((s) => s.id === selectedStepId)) {
      setSelectedStepId(next.start_step_id);
    }
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleToggleKdsEnabled = (checked: boolean) => {
    if (!canEdit || saving) return;
    setDraft((prev) => setWorkflowKdsEnabled(prev, checked));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleStartStepChange = (nextStartId: string) => {
    if (!canEdit || saving) return;
    setDraft((prev) => setWorkflowStartStep(prev, nextStartId));
    setSelectedStepId(nextStartId);
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleAddStep = (stage: 'preparing' | 'completed' = 'preparing') => {
    if (!canEdit || saving || draft.steps.length >= MAX_WORKFLOW_STEPS) {
      return;
    }
    const next = addWorkflowStep(draft, { stage });
    const addedStep = next.steps.find(
      (s) => !draft.steps.some((old) => old.id === s.id)
    );
    setDraft(next);
    if (addedStep) {
      setSelectedStepId(addedStep.id);
    }
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleRemoveStep = (stepId: string) => {
    if (!canEdit || saving) return;
    const result = removeWorkflowStep(draft, stepId);
    if (!result.removed) {
      setErrorMsg(
        (isEn ? result.reasonEn : result.reasonVi) ||
          tx('Không thể xóa bước này.', 'Cannot remove this step.')
      );
      return;
    }
    setDraft(result.config);
    if (selectedStepId === stepId) {
      setSelectedStepId(result.config.start_step_id);
    }
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleResetToSaved = () => {
    if (!canEdit || saving) return;
    const resetCopy = cloneWorkflowConfig(persistedWorkflow);
    setDraft(resetCopy);
    setSelectedStepId(resetCopy.start_step_id);
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleSaveWorkflow = async () => {
    if (!canEdit || saving) return;
    setErrorMsg(null);
    setNoticeMsg(null);

    if (!validation.valid || !validation.config) {
      setErrorMsg(
        localizedValidationErrors[0] ||
          tx(
            'Vui lòng kiểm tra và sửa các lỗi trong sơ đồ quy trình trước khi lưu.',
            'Please fix the workflow validation errors before saving.'
          )
      );
      return;
    }

    setSaving(true);
    try {
      const result = await saveShopOrderWorkflowConfig({
        shopId: activeShop.id,
        draft: validation.config,
        locale: effectiveLocale,
        fetchImpl: props.fetchImpl,
        onUpdateActiveShop: updateActiveShop,
        onRefreshDashboard: refreshDashboard,
      });

      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }

      setDraft(cloneWorkflowConfig(result.workflow));
      setNoticeMsg(
        tx(
          'Đã lưu sơ đồ quy trình đơn hàng cho quán.',
          'Saved store order workflow configuration.'
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const renderStageBadge = (
    stage: OrderWorkflowStepStage,
    isStart: boolean
  ) => {
    if (stage === 'new' || isStart) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-900">
          {tx('1. Nhận đơn (Mới)', '1. Receipt (New)')}
        </span>
      );
    }
    if (stage === 'preparing') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">
          {tx('2. Pha chế / Xử lý', '2. Preparing')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-900">
        {tx('3. Hoàn tất phục vụ', '3. Completed')}
      </span>
    );
  };

  const eligibleNextTargets = selectedStep
    ? getEligibleNextStepTargets(draft, selectedStep.id)
    : [];
  const removeCheckForSelected = selectedStep
    ? canRemoveWorkflowStep(draft, selectedStep.id)
    : { allowed: false };

  return (
    <section
      id="order-workflow-settings"
      data-testid="order-workflow-settings"
      aria-labelledby={`${baseId}-heading`}
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-emerald-400">
            <GitBranch className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={`${baseId}-heading`}
                className="text-sm font-black text-slate-900"
              >
                {tx(
                  'Quy trình xử lý & phục vụ đơn hàng (Flowchart)',
                  'Order Fulfillment Workflow (Flowchart)'
                )}
              </h2>
              <span
                data-testid="order-workflow-active-template-badge"
                className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-800"
              >
                {draft.template_id === 'classic_kitchen'
                  ? tx('Mẫu: Bếp KDS', 'Template: Classic Kitchen')
                  : draft.template_id === 'counter_bar_serve'
                    ? tx('Mẫu: Quầy & Pha chế', 'Template: Counter + Bar')
                    : draft.template_id === 'simple_counter'
                      ? tx('Mẫu: Quầy đơn giản', 'Template: Simple Counter')
                      : tx('Mẫu: Tùy chỉnh', 'Template: Custom')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              {tx(
                'Chọn mẫu có sẵn hoặc tùy chỉnh các bước từ lúc nhận đơn → pha chế/bếp → phục vụ. Hoàn tất phục vụ hoàn toàn độc lập với trạng thái đã thu tiền.',
                'Choose a built-in template or customize how orders move from receipt to preparation and service. Completing service never marks an order paid.'
              )}
            </p>
          </div>
        </div>

        {!canEdit && (
          <span
            data-testid="order-workflow-readonly-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-900"
          >
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {tx(
                'Chỉ Chủ quán / Super Admin được chỉnh sửa',
                'Owner / Super Admin only'
              )}
            </span>
          </span>
        )}
      </div>

      {/* 1. Template Picker Cards */}
      <div className="space-y-2">
        <span className="block text-xs font-extrabold text-slate-800">
          {tx('1. Chọn mẫu quy trình', '1. Choose a workflow template')}
        </span>
        <div
          role="group"
          aria-label={tx('Mẫu quy trình đơn hàng', 'Order workflow templates')}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5"
        >
          {WORKFLOW_TEMPLATE_OPTIONS.map((tpl) => {
            const isSelected = draft.template_id === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                disabled={!canEdit || saving}
                data-testid={`workflow-template-${tpl.id}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectTemplate(tpl.id)}
                className={`flex flex-col justify-between rounded-2xl border p-3 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-black text-slate-900">
                      {isEn ? tpl.titleEn : tpl.titleVi}
                    </span>
                    {isSelected && (
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                        <Check className="h-2.5 w-2.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    {isEn ? tpl.summaryEn : tpl.summaryVi}
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex items-center justify-between">
                  <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 border border-slate-200">
                    {isEn ? tpl.badgeEn : tpl.badgeVi}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Global Workflow Controls: Start Step & KDS Enabled + Add Step buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
        <div className="flex flex-wrap items-center gap-4">
          <label
            htmlFor={`${baseId}-kds-enabled`}
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer"
          >
            <input
              id={`${baseId}-kds-enabled`}
              type="checkbox"
              data-testid="workflow-kds-enabled-checkbox"
              disabled={!canEdit || saving}
              checked={draft.kds_enabled}
              onChange={(e) => handleToggleKdsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            />
            <Monitor className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
            <span>
              {tx(
                'Bật màn hình bếp (KDS) cho quán',
                'Enable Kitchen Display Screen (KDS)'
              )}
            </span>
          </label>

          <div className="flex items-center gap-2">
            <label
              htmlFor={`${baseId}-start-step`}
              className="text-xs font-bold text-slate-700"
            >
              {tx('Bước bắt đầu:', 'Start step:')}
            </label>
            <select
              id={`${baseId}-start-step`}
              data-testid="workflow-start-step-select"
              disabled={!canEdit || saving}
              value={draft.start_step_id}
              onKeyDown={preventFormSubmitOnEnter}
              onChange={(e) => handleStartStepChange(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900"
            >
              {draft.steps
                .filter((s) => s.stage !== 'completed')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {resolveWorkflowLocalizedText(s.label_i18n, effectiveLocale)} (#
                    {s.id})
                  </option>
                ))}
            </select>
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="workflow-add-preparing-step"
              disabled={saving || draft.steps.length >= MAX_WORKFLOW_STEPS}
              onClick={() => handleAddStep('preparing')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>
                {tx('+ Thêm bước xử lý', '+ Add prep step')} (
                {draft.steps.length}/{MAX_WORKFLOW_STEPS})
              </span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Visual Flowchart: Left-to-Right on Desktop, Stacked on Mobile */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-slate-800">
            {tx(
              '2. Sơ đồ luồng bước đơn hàng (Bấm vào thẻ bước để chỉnh chi tiết & mũi tên nối tiếp)',
              '2. Order step flowchart (Click a step card to edit details & outgoing connections)'
            )}
          </span>
          <span className="text-[11px] font-semibold text-slate-500">
            {tx(
              `${draft.steps.length}/${MAX_WORKFLOW_STEPS} bước`,
              `${draft.steps.length}/${MAX_WORKFLOW_STEPS} steps`
            )}
          </span>
        </div>

        <ol
          data-testid="order-workflow-flowchart"
          aria-label={tx(
            'Sơ đồ các bước xử lý đơn hàng',
            'Order workflow steps flowchart'
          )}
          className="flex flex-col lg:flex-row lg:items-stretch gap-2.5 overflow-x-auto pb-2"
        >
          {draft.steps.map((step, index) => {
            const isStart = step.id === draft.start_step_id;
            const isSelected = selectedStep?.id === step.id;
            const stepLabel =
              resolveWorkflowLocalizedText(step.label_i18n, effectiveLocale) ||
              step.id;
            const actionLabel =
              resolveWorkflowLocalizedText(
                step.action_label_i18n,
                effectiveLocale
              ) || stepLabel;
            const nextTargets = step.next_step_ids
              .map((nextId) => stepMap.get(nextId))
              .filter((s): s is OrderWorkflowStepConfig => Boolean(s));

            return (
              <React.Fragment key={step.id}>
                <li
                  data-testid={`workflow-step-card-${step.id}`}
                  className={`flex-1 min-w-[210px] rounded-2xl border p-3.5 transition-all flex flex-col justify-between gap-2.5 ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-1.5">
                      {renderStageBadge(step.stage, isStart)}
                      <span className="font-mono text-[10px] font-bold text-slate-400">
                        #{step.id}
                      </span>
                    </div>

                    <button
                      type="button"
                      data-testid={`workflow-select-step-${step.id}`}
                      onClick={() => setSelectedStepId(step.id)}
                      className="w-full text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 rounded-lg"
                    >
                      <p className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-emerald-700">
                        {stepLabel}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                        {tx('Nút thao tác:', 'Action button:')}{' '}
                        <span className="font-bold text-slate-800">
                          {actionLabel}
                        </span>
                      </p>
                    </button>

                    {/* Flags badges */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {draft.kds_enabled && step.show_on_kds ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                          <Monitor className="h-2.5 w-2.5" aria-hidden="true" />
                          <span>{tx('Hiện trên KDS', 'On KDS')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          <span>{tx('Không qua KDS', 'No KDS')}</span>
                        </span>
                      )}

                      {step.suggest_label_print && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          <Printer className="h-2.5 w-2.5" aria-hidden="true" />
                          <span>{tx('Gợi ý in tem', 'Suggest label')}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Directed outgoing connection chips */}
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      {step.stage === 'completed'
                        ? tx('Điểm kết thúc', 'Terminal step')
                        : tx('Chuyển tiếp sang', 'Leads to')}
                    </span>
                    {step.stage === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                        <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>
                          {tx(
                            'Đã phục vụ xong (Độc lập thu tiền)',
                            'Service complete (Payment independent)'
                          )}
                        </span>
                      </span>
                    ) : nextTargets.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {nextTargets.map((target) => (
                          <span
                            key={target.id}
                            data-testid={`workflow-edge-chip-${step.id}-to-${target.id}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white"
                          >
                            <span aria-hidden="true">→</span>
                            <span>
                              {resolveWorkflowLocalizedText(
                                target.label_i18n,
                                effectiveLocale
                              ) || target.id}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600">
                        <AlertTriangle
                          className="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          {tx(
                            'Chưa chọn bước tiếp theo',
                            'No next step connected'
                          )}
                        </span>
                      </span>
                    )}
                  </div>
                </li>

                {index < draft.steps.length - 1 && (
                  <li
                    aria-hidden="true"
                    className="flex items-center justify-center text-slate-400 py-0.5 lg:py-0 lg:px-0.5 shrink-0"
                  >
                    <ArrowDown className="h-4 w-4 lg:hidden" />
                    <ArrowRight className="hidden lg:block h-4 w-4" />
                  </li>
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </div>

      {/* 4. Selected Step Inspector & Connection Editor */}
      {selectedStep && (
        <div
          data-testid="workflow-selected-step-editor"
          className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-900">
                {tx('Chỉnh sửa bước:', 'Editing step:')}{' '}
                <span className="text-emerald-700">
                  {resolveWorkflowLocalizedText(
                    selectedStep.label_i18n,
                    effectiveLocale
                  ) || selectedStep.id}
                </span>
              </span>
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">
                #{selectedStep.id}
              </span>
            </div>

            {canEdit && (
              <button
                type="button"
                data-testid={`workflow-remove-step-${selectedStep.id}`}
                disabled={saving || !removeCheckForSelected.allowed}
                title={
                  !removeCheckForSelected.allowed
                    ? isEn
                      ? removeCheckForSelected.reasonEn
                      : removeCheckForSelected.reasonVi
                    : tx('Xóa bước này', 'Delete this step')
                }
                onClick={() => handleRemoveStep(selectedStep.id)}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tx('Xóa bước', 'Delete step')}</span>
              </button>
            )}
          </div>

          {/* Step stage & flags */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor={`${baseId}-step-stage`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx('Giai đoạn chuẩn (Stage)', 'Canonical stage')}
              </label>
              <select
                id={`${baseId}-step-stage`}
                data-testid="workflow-step-stage-select"
                disabled={
                  !canEdit ||
                  saving ||
                  selectedStep.id === draft.start_step_id
                }
                value={selectedStep.stage}
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      stage: e.target.value as OrderWorkflowStepStage,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
              >
                {selectedStep.id === draft.start_step_id ? (
                  <option value="new">
                    {tx(
                      'Mới nhận (new — Bước bắt đầu cố định)',
                      'New (Fixed start step)'
                    )}
                  </option>
                ) : (
                  <>
                    <option value="preparing">
                      {tx(
                        'Đang pha chế / xử lý (preparing)',
                        'Preparing / In progress (preparing)'
                      )}
                    </option>
                    <option value="completed">
                      {tx(
                        'Hoàn tất phục vụ (completed — Kết thúc)',
                        'Completed / Served (Terminal)'
                      )}
                    </option>
                  </>
                )}
              </select>
            </div>

            <div className="flex items-end">
              <label
                htmlFor={`${baseId}-step-kds`}
                className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 cursor-pointer"
              >
                <input
                  id={`${baseId}-step-kds`}
                  type="checkbox"
                  data-testid="workflow-step-show-on-kds"
                  disabled={!canEdit || saving}
                  checked={selectedStep.show_on_kds}
                  onChange={(e) =>
                    setDraft((prev) =>
                      updateWorkflowStep(prev, selectedStep.id, {
                        show_on_kds: e.target.checked,
                      })
                    )
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                />
                <span>
                  {tx(
                    'Hiển thị bước này trên KDS bếp',
                    'Show this step on KDS'
                  )}
                </span>
              </label>
            </div>

            <div className="flex items-end">
              <label
                htmlFor={`${baseId}-step-label-print`}
                className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 cursor-pointer"
              >
                <input
                  id={`${baseId}-step-label-print`}
                  type="checkbox"
                  data-testid="workflow-step-suggest-label-print"
                  disabled={!canEdit || saving}
                  checked={Boolean(selectedStep.suggest_label_print)}
                  onChange={(e) =>
                    setDraft((prev) =>
                      updateWorkflowStep(prev, selectedStep.id, {
                        suggest_label_print: e.target.checked,
                      })
                    )
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                />
                <span>
                  {tx(
                    'Gợi ý in tem dán món ở bước này',
                    'Suggest item label print at this step'
                  )}
                </span>
              </label>
            </div>
          </div>

          {/* Step VI/EN Labels */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${baseId}-label-vi`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx('Tên bước (Tiếng Việt) *', 'Step name (Vietnamese) *')}
              </label>
              <input
                id={`${baseId}-label-vi`}
                type="text"
                data-testid="workflow-step-label-vi"
                disabled={!canEdit || saving}
                maxLength={MAX_WORKFLOW_LABEL_LENGTH}
                value={selectedStep.label_i18n.vi || ''}
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      labelVi: e.target.value,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor={`${baseId}-label-en`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx('Tên bước (Tiếng Anh)', 'Step name (English)')}
              </label>
              <input
                id={`${baseId}-label-en`}
                type="text"
                data-testid="workflow-step-label-en"
                disabled={!canEdit || saving}
                maxLength={MAX_WORKFLOW_LABEL_LENGTH}
                value={selectedStep.label_i18n.en || ''}
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      labelEn: e.target.value,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor={`${baseId}-action-vi`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx(
                  'Nhãn nút thao tác nhân viên (VI)',
                  'Staff action button label (VI)'
                )}
              </label>
              <input
                id={`${baseId}-action-vi`}
                type="text"
                data-testid="workflow-step-action-vi"
                disabled={!canEdit || saving}
                maxLength={MAX_WORKFLOW_LABEL_LENGTH}
                value={selectedStep.action_label_i18n.vi || ''}
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      actionLabelVi: e.target.value,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor={`${baseId}-action-en`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx(
                  'Nhãn nút thao tác nhân viên (EN)',
                  'Staff action button label (EN)'
                )}
              </label>
              <input
                id={`${baseId}-action-en`}
                type="text"
                data-testid="workflow-step-action-en"
                disabled={!canEdit || saving}
                maxLength={MAX_WORKFLOW_LABEL_LENGTH}
                value={selectedStep.action_label_i18n.en || ''}
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      actionLabelEn: e.target.value,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor={`${baseId}-customer-vi`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx(
                  'Trạng thái hiển thị cho khách (VI)',
                  'Customer tracking label (VI)'
                )}
              </label>
              <input
                id={`${baseId}-customer-vi`}
                type="text"
                data-testid="workflow-step-customer-vi"
                disabled={!canEdit || saving}
                maxLength={MAX_WORKFLOW_LABEL_LENGTH}
                value={
                  selectedStep.customer_label_i18n?.vi ??
                  selectedStep.label_i18n.vi ??
                  ''
                }
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      customerLabelVi: e.target.value,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor={`${baseId}-customer-en`}
                className="block text-[11px] font-bold text-slate-700 mb-1"
              >
                {tx(
                  'Trạng thái hiển thị cho khách (EN)',
                  'Customer tracking label (EN)'
                )}
              </label>
              <input
                id={`${baseId}-customer-en`}
                type="text"
                data-testid="workflow-step-customer-en"
                disabled={!canEdit || saving}
                maxLength={MAX_WORKFLOW_LABEL_LENGTH}
                value={
                  selectedStep.customer_label_i18n?.en ??
                  selectedStep.label_i18n.en ??
                  ''
                }
                onKeyDown={preventFormSubmitOnEnter}
                onChange={(e) =>
                  setDraft((prev) =>
                    updateWorkflowStep(prev, selectedStep.id, {
                      customerLabelEn: e.target.value,
                    })
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
              />
            </div>
          </div>

          {/* Directed Next-Step Connections */}
          <div className="space-y-2 pt-2 border-t border-slate-200/80">
            <span className="block text-[11px] font-extrabold text-slate-800">
              {selectedStep.stage === 'completed'
                ? tx(
                    'Kết nối bước tiếp theo: Bước Hoàn tất là điểm kết thúc phục vụ nên không có bước tiếp theo.',
                    'Next-step connections: Completed steps are terminal and do not connect to further steps.'
                  )
                : tx(
                    'Chọn các bước tiếp theo có thể chuyển tới từ bước này (→):',
                    'Select valid next steps that this step can transition to (→):'
                  )}
            </span>

            {selectedStep.stage !== 'completed' && (
              <div className="flex flex-wrap gap-2">
                {eligibleNextTargets.map((target) => {
                  const checked = selectedStep.next_step_ids.includes(
                    target.id
                  );
                  const targetName =
                    resolveWorkflowLocalizedText(
                      target.label_i18n,
                      effectiveLocale
                    ) || target.id;
                  return (
                    <label
                      key={target.id}
                      data-testid={`workflow-connect-${selectedStep.id}-to-${target.id}`}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                        checked
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEdit || saving}
                        checked={checked}
                        onChange={(e) =>
                          setDraft((prev) =>
                            toggleWorkflowStepConnection(
                              prev,
                              selectedStep.id,
                              target.id,
                              e.target.checked
                            )
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
                      />
                      <span aria-hidden="true">→</span>
                      <span>{targetName}</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        ({target.stage})
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Live Pre-Save Validation Errors */}
      {!validation.valid && localizedValidationErrors.length > 0 && (
        <div
          role="alert"
          data-testid="order-workflow-validation-errors"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 space-y-1.5 text-xs text-rose-900"
        >
          <div className="flex items-center gap-2 font-black text-rose-950">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-rose-600"
              aria-hidden="true"
            />
            <span>
              {tx(
                'Sơ đồ quy trình cần chỉnh lại trước khi lưu:',
                'Workflow requires fixes before saving:'
              )}
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-0.5 font-semibold">
            {localizedValidationErrors.map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* API Error / Success Feedback */}
      {errorMsg && (
        <div
          role="alert"
          data-testid="order-workflow-error"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-800"
        >
          {errorMsg}
        </div>
      )}

      {noticeMsg && (
        <div
          role="status"
          aria-live="polite"
          data-testid="order-workflow-notice"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-800"
        >
          {noticeMsg}
        </div>
      )}

      {/* 6. Independent Save / Reset Footer */}
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            data-testid="order-workflow-reset-button"
            disabled={saving || !isDirty}
            onClick={handleResetToSaved}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tx('Hoàn tác về bản đã lưu', 'Reset to saved')}</span>
          </button>

          <button
            type="button"
            data-testid="order-workflow-save-button"
            disabled={saving || !validation.valid}
            onClick={() => void handleSaveWorkflow()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>
              {saving
                ? tx('Đang lưu quy trình...', 'Saving workflow...')
                : tx('Lưu quy trình đơn hàng', 'Save order workflow')}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
