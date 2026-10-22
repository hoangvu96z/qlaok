'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, UserPlus, Users } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { getAuthHeaders } from '@/lib/auth-session';
import { isShopOwnerMembership } from '@/lib/dashboard-nav';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import type { ShopMembership, ShopRole } from '@/types/qlaok';

/** Roles an owner can assign from the UI (owner role is never assignable). */
const ASSIGNABLE_ROLES: ShopRole[] = ['cashier', 'staff'];

/**
 * Owner-only staff management for the active shop. Rendered inside the
 * Settings page <form>, so every control is type="button" and Enter is
 * intercepted to avoid submitting the outer settings form.
 */
export function ShopMembersManager() {
  const { activeShop, activeMembership } = useDashboard();
  const { tx } = useAppI18n();
  const [members, setMembers] = useState<ShopMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ShopRole>('staff');
  const [inviting, setInviting] = useState(false);

  const isOwner = isShopOwnerMembership(activeMembership);
  const shopId = activeShop?.id;
  const ownerId = activeShop?.owner_id;

  const roleLabel = (role: ShopRole) =>
    role === 'owner'
      ? tx('Chủ quán', 'Owner')
      : role === 'cashier'
        ? tx('Thu ngân', 'Cashier')
        : tx('Nhân viên', 'Staff');

  const readError = async (res: Response, fallback: string) => {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error || `${fallback} (HTTP ${res.status})`;
  };

  const loadMembers = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shops?action=memberships&shopId=${encodeURIComponent(shopId)}`,
        { headers: getAuthHeaders(), cache: 'no-store' }
      );
      if (!res.ok) {
        throw new Error(
          await readError(res, tx('Không thể tải danh sách nhân viên', 'Could not load members'))
        );
      }
      const data = (await res.json()) as { memberships?: ShopMembership[] };
      setMembers(
        (data.memberships || []).filter(
          (m) => m.user_id !== ownerId && !m.id.startsWith('mem-owner-')
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [shopId, ownerId, tx]);

  useEffect(() => {
    if (isOwner) void loadMembers();
  }, [isOwner, loadMembers]);

  if (!activeShop || !isOwner) return null;

  const postMemberAction = async (
    body: Record<string, unknown>,
    fallback: string
  ) => {
    const res = await fetch('/api/shops', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ shop_id: activeShop.id, ...body }),
    });
    if (!res.ok) throw new Error(await readError(res, fallback));
    return res.json();
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || !email.includes('@')) {
      setError(tx('Vui lòng nhập email hợp lệ.', 'Please enter a valid email.'));
      return;
    }
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      await postMemberAction(
        { action: 'invite_member', email, role: inviteRole },
        tx('Không thể thêm nhân viên', 'Could not add member')
      );
      setInviteEmail('');
      setNotice(tx('Đã thêm {email} vào cửa hàng.', 'Added {email} to the store.', { email }));
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInviting(false);
    }
  };

  const handleUpdate = async (
    member: ShopMembership,
    patch: { role?: ShopRole; is_active?: boolean }
  ) => {
    setBusyUserId(member.user_id);
    setError(null);
    setNotice(null);
    try {
      await postMemberAction(
        {
          action: 'upsert_member',
          user_id: member.user_id,
          email: member.email,
          full_name: member.full_name,
          role: patch.role ?? member.role,
          is_active: patch.is_active ?? member.is_active,
        },
        tx('Không thể cập nhật nhân viên', 'Could not update member')
      );
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (member: ShopMembership) => {
    const label = member.email || member.full_name || member.user_id;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        tx('Xóa {name} khỏi cửa hàng?', 'Remove {name} from the store?', { name: label })
      )
    ) {
      return;
    }
    setBusyUserId(member.user_id);
    setError(null);
    setNotice(null);
    try {
      const data = (await postMemberAction(
        { action: 'delete_member', user_id: member.user_id },
        tx('Không thể xóa nhân viên', 'Could not remove member')
      )) as { deleted?: boolean };
      if (data.deleted === false) {
        throw new Error(tx('Không tìm thấy nhân viên để xóa.', 'Member not found.'));
      }
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div
      data-testid="shop-members-manager"
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
    >
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-600" />
          <span>{tx('Nhân viên & phân quyền', 'Staff & roles')}</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {tx(
            'Nhân viên cần tự đăng ký tài khoản Qlaok bằng email trước, sau đó bạn thêm họ vào đây. Thu ngân được thu tiền & giảm giá; nhân viên phục vụ chỉ nhận/làm đơn. Cả hai đều được bật/tắt còn món và tồn kho.',
            'Staff must first sign up for a Qlaok account with their email, then add them here. Cashiers can collect payments & apply discounts; staff can only take/fulfill orders. Both can toggle item availability and stock.'
          )}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
          {notice}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleInvite();
            }
          }}
          placeholder={tx('email.nhanvien@vidu.com', 'staff.email@example.com')}
          aria-label={tx('Email nhân viên', 'Member email')}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as ShopRole)}
          aria-label={tx('Vai trò', 'Role')}
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800"
        >
          {ASSIGNABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void handleInvite()}
          disabled={inviting}
          data-testid="shop-members-invite"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          <span>{tx('Thêm nhân viên', 'Add member')}</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {tx('Đang tải danh sách...', 'Loading members...')}
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-slate-500">
          {tx('Chưa có nhân viên nào.', 'No members yet.')}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {members.map((member) => {
            const busy = busyUserId === member.user_id;
            return (
              <li
                key={member.user_id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-900">
                    {member.full_name || member.email || member.user_id}
                    {!member.is_active && (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">
                        {tx('Đã tạm khóa', 'Deactivated')}
                      </span>
                    )}
                  </p>
                  {member.email && (
                    <p className="truncate text-[11px] text-slate-500">{member.email}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <select
                    value={member.role}
                    disabled={busy}
                    onChange={(e) =>
                      void handleUpdate(member, { role: e.target.value as ShopRole })
                    }
                    aria-label={tx('Đổi vai trò', 'Change role')}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-800"
                  >
                    {(member.role === 'owner'
                      ? (['owner', ...ASSIGNABLE_ROLES] as ShopRole[])
                      : ASSIGNABLE_ROLES
                    ).map((role) => (
                      <option key={role} value={role} disabled={role === 'owner'}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void handleUpdate(member, { is_active: !member.is_active })
                    }
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {member.is_active
                      ? tx('Tạm khóa', 'Deactivate')
                      : tx('Kích hoạt', 'Activate')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRemove(member)}
                    aria-label={tx('Xóa nhân viên', 'Remove member')}
                    title={tx('Xóa nhân viên', 'Remove member')}
                    className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
