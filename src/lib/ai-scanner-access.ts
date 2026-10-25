import { canUseAiOcr } from '@/lib/plan-limits';
import type { PlanTier } from '@/types/qlaok';

export interface ResolvedShopPlanState {
  shopId: string;
  plan: PlanTier;
}

export function resolveAiScannerAccess({
  activeShopId,
  resolvedShopPlan,
  planErrorShopId,
  isSuperAdminBypass,
}: {
  activeShopId?: string | null;
  resolvedShopPlan?: ResolvedShopPlanState | null;
  planErrorShopId?: string | null;
  isSuperAdminBypass?: boolean;
}): {
  isShopPlanResolved: boolean;
  resolvedPlan: PlanTier | null;
  isPlanError: boolean;
  isPlanLoading: boolean;
  isUnlocked: boolean;
} {
  const isShopPlanResolved = Boolean(
    activeShopId && resolvedShopPlan?.shopId === activeShopId
  );
  const resolvedPlan = isShopPlanResolved ? resolvedShopPlan!.plan : null;
  const isPlanError = Boolean(
    !isSuperAdminBypass && activeShopId && planErrorShopId === activeShopId
  );
  const isPlanLoading = Boolean(
    !isSuperAdminBypass && activeShopId && !isPlanError && !isShopPlanResolved
  );
  const isUnlocked = Boolean(
    isSuperAdminBypass || (isShopPlanResolved && canUseAiOcr(resolvedPlan))
  );

  return {
    isShopPlanResolved,
    resolvedPlan,
    isPlanError,
    isPlanLoading,
    isUnlocked,
  };
}
