'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Key,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { getAuthHeaders } from '@/lib/auth-session';
import { isShopOwnerMembership } from '@/lib/dashboard-nav';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import type { ShopMembership, ShopPermission, ShopRole } from '@/types/qlaok';

/**
 * Roles an owner can assign from the UI.
 * Owner and admin roles are never assignable to staff.
 */
export const ASSIGNABLE_STAFF_ROLES: Array<'cashier' | 'staff'> = [
  'cashier',
  'staff',
];

/**
 * Allowed permissions that a shop owner can assign to a staff account.
 * Owner-only permissions ('members.manage') are strictly forbidden and excluded.
 */
export const ALLOWED_STAFF_PERMISSIONS: ShopPermission[] = [
  'orders.view',
  'orders.create',
  'orders.fulfill',
  'orders.edit_items',
  'orders.cancel_unpaid',
  'orders.print_kitchen',
  'orders.print_provisional',
  'payment.collect',
  'discount.apply',
  'payment.refund',
  'catalog.view',
  'catalog.manage',
  'inventory.adjust',
  'promotions.manage',
  'settings.manage',
  'settings.bank',
  'reports.view',
];

export const DEFAULT_STAFF_ROLE_PERMISSIONS: Record<
  'cashier' | 'staff',
  ShopPermission[]
> = {
  cashier: [
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.edit_items',
    'orders.cancel_unpaid',
    'orders.print_kitchen',
    'orders.print_provisional',
    'payment.collect',
    'discount.apply',
    'catalog.view',
    'inventory.adjust',
  ],
  staff: [
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.print_kitchen',
    'catalog.view',
    'inventory.adjust',
  ],
};

export const STAFF_USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;
export const MIN_STAFF_PASSWORD_LEN = 6;
export const MAX_STAFF_PASSWORD_LEN = 128;

export interface PermissionDefinition {
  key: ShopPermission;
  category: 'orders' | 'payment' | 'catalog' | 'settings';
  labelVi: string;
  labelEn: string;
  descVi: string;
  descEn: string;
}

export const STAFF_PERMISSIONS_CONFIG: PermissionDefinition[] = [
  {
    key: 'orders.view',
    category: 'orders',
    labelVi: 'Xem đơn hàng',
    labelEn: 'View orders',
    descVi: 'Xem danh sách và chi tiết đơn hàng của quán',
    descEn: 'View order list and ticket details for the shop',
  },
  {
    key: 'orders.create',
    category: 'orders',
    labelVi: 'Tạo đơn tại bàn',
    labelEn: 'Create orders',
    descVi: 'Gọi món và tạo đơn mới cho khách tại bàn hoặc mang đi trên mobile/web',
    descEn: 'Assist table guests by creating orders on mobile or web POS',
  },
  {
    key: 'orders.fulfill',
    category: 'orders',
    labelVi: 'Pha chế & phục vụ (KDS)',
    labelEn: 'Fulfill orders (KDS)',
    descVi: 'Cập nhật tiến độ món đang làm và hoàn tất đơn trên màn hình bếp',
    descEn: 'Update preparation stages and mark orders served on KDS',
  },
  {
    key: 'orders.edit_items',
    category: 'orders',
    labelVi: 'Sửa món & ghi chú đơn',
    labelEn: 'Edit items & notes',
    descVi: 'Thêm bớt món, đổi món hoặc sửa ghi chú khi đơn chưa thanh toán',
    descEn: 'Add, remove or update items and custom notes on open orders',
  },
  {
    key: 'orders.cancel_unpaid',
    category: 'orders',
    labelVi: 'Hủy đơn chưa trả tiền',
    labelEn: 'Cancel unpaid orders',
    descVi: 'Hủy đơn hàng chưa thanh toán khi khách hủy hoặc có nhầm lẫn',
    descEn: 'Cancel open unpaid orders if the guest cancels or makes a mistake',
  },
  {
    key: 'orders.print_kitchen',
    category: 'orders',
    labelVi: 'In phiếu bếp & tem nhãn',
    labelEn: 'Print kitchen tickets & labels',
    descVi: 'Gửi in phiếu chế biến cho bếp hoặc in tem dán ly pha chế',
    descEn: 'Print kitchen production tickets or beverage cup stickers',
  },
  {
    key: 'orders.print_provisional',
    category: 'orders',
    labelVi: 'In phiếu tạm tính',
    labelEn: 'Print provisional bill',
    descVi: 'In hóa đơn tạm tính gửi khách kiểm tra trước khi thanh toán',
    descEn: 'Print provisional bill for guest review prior to payment',
  },
  {
    key: 'payment.collect',
    category: 'payment',
    labelVi: 'Thu tiền & xác nhận trả',
    labelEn: 'Collect payments',
    descVi: 'Xác nhận thanh toán tiền mặt hoặc VietQR và chốt đơn đã trả',
    descEn: 'Confirm cash or VietQR payments and mark orders paid',
  },
  {
    key: 'discount.apply',
    category: 'payment',
    labelVi: 'Áp dụng giảm giá',
    labelEn: 'Apply discounts',
    descVi: 'Chiết khấu % hoặc trừ tiền trên từng món và trên tổng đơn',
    descEn: 'Apply line item or total bill percentage/amount discounts',
  },
  {
    key: 'payment.refund',
    category: 'payment',
    labelVi: 'Hoàn tiền đơn hàng',
    labelEn: 'Refund payments',
    descVi: 'Xử lý hoàn tiền cho đơn đã trả kèm nhập lý do kiểm toán',
    descEn: 'Process payment refunds with required reason for audit log',
  },
  {
    key: 'catalog.view',
    category: 'catalog',
    labelVi: 'Xem thực đơn',
    labelEn: 'View menu',
    descVi: 'Xem danh sách danh mục, món ăn và tùy chọn kèm theo',
    descEn: 'Browse categories, menu items, prices, and option choices',
  },
  {
    key: 'catalog.manage',
    category: 'catalog',
    labelVi: 'Quản lý thực đơn & giá bán',
    labelEn: 'Manage menu & prices',
    descVi: 'Tạo mới, chỉnh sửa giá bán, tải ảnh và sửa nhóm tùy chọn món',
    descEn: 'Create items, edit prices, upload photos, and edit options',
  },
  {
    key: 'inventory.adjust',
    category: 'catalog',
    labelVi: 'Bật/tắt món & chỉnh tồn kho',
    labelEn: 'Adjust stock & availability',
    descVi: 'Thao tác nhanh bật/tắt còn món và điều chỉnh số lượng tồn kho',
    descEn: 'Quickly toggle item availability and adjust stock counts',
  },
  {
    key: 'promotions.manage',
    category: 'settings',
    labelVi: 'Quản lý khuyến mãi',
    labelEn: 'Manage promotions',
    descVi: 'Cài đặt banner thông báo, popup ưu đãi và flash sale',
    descEn: 'Configure promotional banners, popups, and flash sales',
  },
  {
    key: 'settings.manage',
    category: 'settings',
    labelVi: 'Cài đặt quán',
    labelEn: 'Manage shop settings',
    descVi: 'Thay đổi thông tin liên hệ, giờ mở cửa và giao diện storefront',
    descEn: 'Update shop contact details, operating hours, and appearance',
  },
  {
    key: 'settings.bank',
    category: 'settings',
    labelVi: 'Cấu hình tài khoản ngân hàng',
    labelEn: 'Configure receiving bank',
    descVi: 'Thay đổi số tài khoản ngân hàng nhận tiền chuyển khoản VietQR',
    descEn: 'Configure receiving bank account and VietQR payment information',
  },
  {
    key: 'reports.view',
    category: 'settings',
    labelVi: 'Xem báo cáo doanh thu',
    labelEn: 'View sales reports',
    descVi: 'Xem số liệu doanh thu, số lượng đơn và phân tích kinh doanh',
    descEn: 'View sales revenue totals, order volume, and analytics charts',
  },
];

export const PERMISSION_CATEGORIES = [
  {
    id: 'orders',
    labelVi: 'Đơn hàng & Phục vụ bàn',
    labelEn: 'Orders & Table Service',
  },
  {
    id: 'payment',
    labelVi: 'Thanh toán & Thu ngân',
    labelEn: 'Payments & Checkout',
  },
  {
    id: 'catalog',
    labelVi: 'Thực đơn & Tồn kho',
    labelEn: 'Menu & Inventory',
  },
  {
    id: 'settings',
    labelVi: 'Cài đặt & Báo cáo',
    labelEn: 'Settings & Reports',
  },
] as const;

export function isShopScopedStaff(member: ShopMembership): boolean {
  return Boolean(
    member.username ||
      member.account_type === 'staff' ||
      member.user_id.startsWith('staff-acct-')
  );
}

export function validateUsernameClient(raw: string): {
  ok: boolean;
  messageVi?: string;
  messageEn?: string;
} {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return {
      ok: false,
      messageVi: 'Vui lòng nhập tên đăng nhập nhân viên.',
      messageEn: 'Please enter a staff username.',
    };
  }
  if (trimmed.length < 3 || trimmed.length > 32) {
    return {
      ok: false,
      messageVi: 'Tên đăng nhập phải từ 3–32 ký tự.',
      messageEn: 'Username must be 3–32 characters.',
    };
  }
  if (!STAFF_USERNAME_REGEX.test(trimmed)) {
    return {
      ok: false,
      messageVi:
        'Tên đăng nhập chỉ gồm chữ thường (a-z), số (0-9), dấu chấm (.), gạch dưới (_) hoặc gạch ngang (-).',
      messageEn:
        'Username may only contain lowercase letters, numbers, dot (.), underscore (_), or dash (-).',
    };
  }
  return { ok: true };
}

export function validatePasswordClient(raw: string): {
  ok: boolean;
  messageVi?: string;
  messageEn?: string;
} {
  if (!raw || raw.length < MIN_STAFF_PASSWORD_LEN) {
    return {
      ok: false,
      messageVi: `Mật khẩu phải có tối thiểu ${MIN_STAFF_PASSWORD_LEN} ký tự.`,
      messageEn: `Password must be at least ${MIN_STAFF_PASSWORD_LEN} characters.`,
    };
  }
  if (raw.length > MAX_STAFF_PASSWORD_LEN) {
    return {
      ok: false,
      messageVi: `Mật khẩu không được vượt quá ${MAX_STAFF_PASSWORD_LEN} ký tự.`,
      messageEn: `Password cannot exceed ${MAX_STAFF_PASSWORD_LEN} characters.`,
    };
  }
  return { ok: true };
}

/**
 * Owner-only staff management for the active shop.
 * Rendered inside the Settings page <form>, so EVERY control is type="button"
 * and Enter key presses are strictly intercepted to avoid submitting the outer form.
 */
export function ShopMembersManager() {
  const { activeShop, activeMembership } = useDashboard();
  const { tx } = useAppI18n();

  // Primary members list state
  const [members, setMembers] = useState<ShopMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Create staff account form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<'cashier' | 'staff'>('staff');
  const [newPermissions, setNewPermissions] = useState<ShopPermission[]>(
    DEFAULT_STAFF_ROLE_PERMISSIONS.staff
  );
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showCreatePermissions, setShowCreatePermissions] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit staff member modal state
  const [editingMember, setEditingMember] = useState<ShopMembership | null>(null);
  const [editRole, setEditRole] = useState<'cashier' | 'staff'>('staff');
  const [editFullName, setEditFullName] = useState('');
  const [editPermissions, setEditPermissions] = useState<ShopPermission[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Reset password modal state
  const [resettingMember, setResettingMember] = useState<ShopMembership | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Delete confirmation modal state
  const [deletingMember, setDeletingMember] = useState<ShopMembership | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Secondary legacy email invite state
  const [showEmailInvite, setShowEmailInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ShopRole>('staff');
  const [inviting, setInviting] = useState(false);

  const isOwner = isShopOwnerMembership(activeMembership);
  const shopId = activeShop?.id;
  const ownerId = activeShop?.owner_id;

  const roleLabel = useCallback(
    (role: ShopRole) =>
      role === 'owner'
        ? tx('Chủ quán', 'Owner')
        : role === 'cashier'
          ? tx('Thu ngân', 'Cashier')
          : tx('Nhân viên', 'Staff'),
    [tx]
  );

  const readError = async (res: Response, fallback: string) => {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
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
          await readError(
            res,
            tx('Không thể tải danh sách nhân viên', 'Could not load members')
          )
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

  // Switch role in creation form: updates role and preselects role defaults
  const handleSelectNewRole = (role: 'cashier' | 'staff') => {
    setNewRole(role);
    setNewPermissions(DEFAULT_STAFF_ROLE_PERMISSIONS[role]);
  };

  // Toggle a single permission in creation form
  const handleToggleNewPermission = (permKey: ShopPermission) => {
    setNewPermissions((prev) =>
      prev.includes(permKey)
        ? prev.filter((p) => p !== permKey)
        : [...prev, permKey]
    );
  };

  // Reset creation permissions to currently selected role preset
  const handleResetNewPermissionsToRole = () => {
    setNewPermissions(DEFAULT_STAFF_ROLE_PERMISSIONS[newRole]);
  };

  // Create staff account
  const handleCreateStaff = async () => {
    const cleanUsername = newUsername.trim().toLowerCase();
    const userValidation = validateUsernameClient(cleanUsername);
    if (!userValidation.ok) {
      setError(tx(userValidation.messageVi || '', userValidation.messageEn || ''));
      return;
    }

    const passValidation = validatePasswordClient(newPassword);
    if (!passValidation.ok) {
      setError(tx(passValidation.messageVi || '', passValidation.messageEn || ''));
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await postMemberAction(
        {
          action: 'create_staff_member',
          username: cleanUsername,
          password: newPassword,
          full_name: newFullName.trim() || undefined,
          role: newRole,
          permissions: newPermissions,
          is_active: true,
        },
        tx('Không thể tạo tài khoản nhân viên', 'Could not create staff account')
      );

      setNewUsername('');
      setNewPassword('');
      setNewFullName('');
      setNewPermissions(DEFAULT_STAFF_ROLE_PERMISSIONS[newRole]);
      setShowCreatePermissions(false);
      setNotice(
        tx(
          'Đã tạo tài khoản nhân viên @{username} thành công.',
          'Staff account @{username} created successfully.',
          { username: cleanUsername }
        )
      );
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  // Open Edit Modal for a member
  const handleOpenEditModal = (member: ShopMembership) => {
    setEditingMember(member);
    const initialRole: 'cashier' | 'staff' =
      member.role === 'cashier' ? 'cashier' : 'staff';
    setEditRole(initialRole);
    setEditFullName(member.full_name || '');
    const currentPerms = Array.isArray(member.permissions)
      ? member.permissions.filter((p) => ALLOWED_STAFF_PERMISSIONS.includes(p))
      : DEFAULT_STAFF_ROLE_PERMISSIONS[initialRole];
    setEditPermissions(currentPerms);
    setEditError(null);
  };

  // Switch role in edit modal
  const handleSelectEditRole = (role: 'cashier' | 'staff') => {
    setEditRole(role);
    setEditPermissions(DEFAULT_STAFF_ROLE_PERMISSIONS[role]);
  };

  // Toggle a single permission in edit modal
  const handleToggleEditPermission = (permKey: ShopPermission) => {
    setEditPermissions((prev) =>
      prev.includes(permKey)
        ? prev.filter((p) => p !== permKey)
        : [...prev, permKey]
    );
  };

  // Save changes from Edit Modal
  const handleSaveEditMember = async () => {
    if (!editingMember) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const isStaff = isShopScopedStaff(editingMember);
      const actionName = isStaff ? 'update_staff_member' : 'upsert_member';

      await postMemberAction(
        {
          action: actionName,
          user_id: editingMember.user_id,
          username: editingMember.username,
          email: editingMember.email,
          full_name: editFullName.trim() || undefined,
          role: editRole,
          permissions: editPermissions,
          is_active: editingMember.is_active,
        },
        tx('Không thể cập nhật nhân viên', 'Could not update staff member')
      );

      const targetLabel = editingMember.username
        ? `@${editingMember.username}`
        : editFullName.trim() || editingMember.email || editingMember.user_id;

      setEditingMember(null);
      setNotice(
        tx(
          'Đã cập nhật thông tin nhân viên {name} thành công.',
          'Staff member {name} updated successfully.',
          { name: targetLabel }
        )
      );
      await loadMembers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle active/deactivated state
  const handleToggleActive = async (member: ShopMembership) => {
    setBusyUserId(member.user_id);
    setError(null);
    setNotice(null);
    try {
      const isStaff = isShopScopedStaff(member);
      const actionName = isStaff ? 'update_staff_member' : 'upsert_member';
      await postMemberAction(
        {
          action: actionName,
          user_id: member.user_id,
          username: member.username,
          email: member.email,
          role: member.role,
          permissions: member.permissions,
          is_active: !member.is_active,
        },
        tx(
          'Không thể cập nhật trạng thái nhân viên',
          'Could not update staff status'
        )
      );
      const targetLabel = member.username
        ? `@${member.username}`
        : member.full_name || member.email || member.user_id;
      setNotice(
        member.is_active
          ? tx(
              'Đã tạm khóa tài khoản {name}.',
              'Account {name} has been deactivated.',
              { name: targetLabel }
            )
          : tx(
              'Đã kích hoạt lại tài khoản {name}.',
              'Account {name} has been activated.',
              { name: targetLabel }
            )
      );
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUserId(null);
    }
  };

  // Open Reset Password Modal
  const handleOpenResetPassword = (member: ShopMembership) => {
    setResettingMember(member);
    setResetPassword('');
    setShowResetPassword(false);
    setResetError(null);
  };

  // Confirm Reset Password
  const handleConfirmResetPassword = async () => {
    if (!resettingMember) return;
    const passValidation = validatePasswordClient(resetPassword);
    if (!passValidation.ok) {
      setResetError(
        tx(passValidation.messageVi || '', passValidation.messageEn || '')
      );
      return;
    }

    setResetting(true);
    setResetError(null);
    try {
      await postMemberAction(
        {
          action: 'reset_staff_password',
          user_id: resettingMember.user_id,
          username: resettingMember.username,
          new_password: resetPassword,
        },
        tx('Không thể đặt lại mật khẩu', 'Could not reset password')
      );

      const targetLabel = resettingMember.username
        ? `@${resettingMember.username}`
        : resettingMember.full_name || resettingMember.user_id;

      setResettingMember(null);
      setResetPassword('');
      setNotice(
        tx(
          'Đã đặt lại mật khẩu cho {user}. Các phiên đăng nhập cũ đã bị chấm dứt.',
          'Password reset for {user}. All previous active sessions have been invalidated.',
          { user: targetLabel }
        )
      );
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  // Open Delete Confirm Modal
  const handleOpenDeleteConfirm = (member: ShopMembership) => {
    setDeletingMember(member);
    setDeleteError(null);
  };

  // Confirm Delete Member
  const handleConfirmDelete = async () => {
    if (!deletingMember) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const isStaff = isShopScopedStaff(deletingMember);
      const actionName = isStaff ? 'delete_staff_member' : 'delete_member';
      const data = (await postMemberAction(
        {
          action: actionName,
          user_id: deletingMember.user_id,
        },
        tx('Không thể xóa nhân viên', 'Could not remove member')
      )) as { deleted?: boolean };

      if (data.deleted === false) {
        throw new Error(
          tx('Không tìm thấy nhân viên để xóa.', 'Member not found.')
        );
      }

      const targetLabel = deletingMember.username
        ? `@${deletingMember.username}`
        : deletingMember.full_name || deletingMember.email || deletingMember.user_id;

      setDeletingMember(null);
      setNotice(
        tx(
          'Đã xóa tài khoản {name} khỏi cửa hàng.',
          'Account {name} has been removed from the shop.',
          { name: targetLabel }
        )
      );
      await loadMembers();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  // Legacy Email Invite
  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || !email.includes('@')) {
      setError(
        tx('Vui lòng nhập email hợp lệ.', 'Please enter a valid email.')
      );
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
      setNotice(
        tx(
          'Đã thêm {email} vào cửa hàng.',
          'Added {email} to the store.',
          { email }
        )
      );
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInviting(false);
    }
  };

  return (
    <div
      data-testid="shop-members-manager"
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-6"
    >
      {/* Header section */}
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-600" />
          <span>{tx('Nhân viên & phân quyền', 'Staff & accounts')}</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          {tx(
            'Chủ quán tự tạo tài khoản tên đăng nhập & mật khẩu riêng cho nhân viên theo từng quán. Nhân viên không cần đăng ký email cá nhân hay tạo cửa hàng riêng.',
            'Create shop-scoped username & password accounts for your staff. Staff do not need personal email registration or their own shop.'
          )}
        </p>
      </div>

      {/* Global alert messages */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 flex items-start justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-700"
            aria-label={tx('Đóng thông báo lỗi', 'Dismiss error')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 flex items-start justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-500 hover:text-emerald-700"
            aria-label={tx('Đóng thông báo', 'Dismiss notice')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Primary creation form: Owner creates username/password account */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5 text-emerald-600" />
              <span>{tx('Tạo tài khoản nhân viên mới', 'Create new staff account')}</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {tx(
                'Cấp tài khoản đăng nhập cho thu ngân hoặc nhân viên phục vụ bàn.',
                'Provide login credentials for cashier or table service staff.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
            <span>{tx('Vai trò:', 'Role:')}</span>
            <div className="inline-flex rounded-xl bg-slate-200/70 p-0.5">
              {ASSIGNABLE_STAFF_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleSelectNewRole(r)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                    newRole === r
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {roleLabel(r)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Username */}
          <div className="space-y-1">
            <label
              htmlFor="create-staff-username-input"
              className="text-[11px] font-bold text-slate-700 flex items-center justify-between"
            >
              <span>{tx('Tên đăng nhập', 'Username')} *</span>
              <span className="text-[10px] text-slate-400 font-normal">3–32 ký tự</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs select-none">
                @
              </span>
              <input
                id="create-staff-username-input"
                type="text"
                value={newUsername}
                onChange={(e) =>
                  setNewUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateStaff();
                  }
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                placeholder={tx('thungan_sang', 'cashier_01')}
                data-testid="create-staff-username"
                className="w-full rounded-xl border border-slate-200 bg-white pl-7 pr-3 py-2 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Initial Password */}
          <div className="space-y-1">
            <label
              htmlFor="create-staff-password-input"
              className="text-[11px] font-bold text-slate-700 flex items-center justify-between"
            >
              <span>{tx('Mật khẩu khởi tạo', 'Initial password')} *</span>
              <span className="text-[10px] text-slate-400 font-normal">≥ 6 ký tự</span>
            </label>
            <div className="relative">
              <input
                id="create-staff-password-input"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateStaff();
                  }
                }}
                autoComplete="new-password"
                placeholder={tx('Mật khẩu tạm thời', 'Temporary password')}
                data-testid="create-staff-password"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 pr-9 focus:border-emerald-500 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                aria-label={
                  showNewPassword
                    ? tx('Ẩn mật khẩu', 'Hide password')
                    : tx('Hiện mật khẩu', 'Show password')
                }
              >
                {showNewPassword ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Full Name (optional) */}
          <div className="space-y-1">
            <label
              htmlFor="create-staff-fullname-input"
              className="text-[11px] font-bold text-slate-700"
            >
              {tx('Tên hiển thị (không bắt buộc)', 'Display name (optional)')}
            </label>
            <input
              id="create-staff-fullname-input"
              type="text"
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateStaff();
                }
              }}
              placeholder={tx('VD: Nguyễn Thu Ngân', 'e.g. Sarah Nguyen')}
              data-testid="create-staff-fullname"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>
        </div>

        {/* Permissions expander toggle */}
        <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-200/80">
          <button
            type="button"
            onClick={() => setShowCreatePermissions((prev) => !prev)}
            data-testid="toggle-create-permissions"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700 hover:text-slate-900"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
            <span>
              {showCreatePermissions
                ? tx('Thu gọn phân quyền chi tiết', 'Collapse permissions')
                : tx(
                    'Tùy chỉnh quyền hạn ({count}/{total})',
                    'Customize permissions ({count}/{total})',
                    {
                      count: newPermissions.length,
                      total: ALLOWED_STAFF_PERMISSIONS.length,
                    }
                  )}
            </span>
            {showCreatePermissions ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          <div className="flex items-center gap-2">
            {showCreatePermissions && (
              <button
                type="button"
                onClick={handleResetNewPermissionsToRole}
                data-testid="reset-create-permissions"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200/60"
              >
                <RotateCcw className="h-3 w-3" />
                <span>{tx('Đặt lại theo vai trò', 'Reset to role default')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleCreateStaff()}
              disabled={creating}
              data-testid="create-staff-submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors shadow-xs"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              <span>{tx('Tạo tài khoản', 'Create account')}</span>
            </button>
          </div>
        </div>

        {/* Expandable permissions checklist */}
        {showCreatePermissions && (
          <div className="pt-2 border-t border-slate-200/80 space-y-3">
            <p className="text-[11px] text-slate-500">
              {tx(
                'Lưu ý: Quyền "Tạo đơn tại bàn" (orders.create) giúp nhân viên phục vụ dùng điện thoại hỗ trợ khách đặt món tại bàn.',
                'Note: "Create orders" (orders.create) allows table staff to take orders and assist guests from mobile devices.'
              )}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PERMISSION_CATEGORIES.map((cat) => {
                const catPerms = STAFF_PERMISSIONS_CONFIG.filter(
                  (p) => p.category === cat.id
                );
                return (
                  <div
                    key={cat.id}
                    className="rounded-xl border border-slate-200/90 bg-white p-3 space-y-2"
                  >
                    <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                      {tx(cat.labelVi, cat.labelEn)}
                    </h4>
                    <div className="space-y-1.5">
                      {catPerms.map((perm) => {
                        const checked = newPermissions.includes(perm.key);
                        return (
                          <label
                            key={perm.key}
                            className={`flex items-start gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                              checked ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleNewPermission(perm.key)}
                              className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 leading-tight">
                                {tx(perm.labelVi, perm.labelEn)}
                              </p>
                              <p className="text-[10px] text-slate-500 leading-tight">
                                {tx(perm.descVi, perm.descEn)}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Staff Accounts List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            {tx(
              'Danh sách tài khoản ({count})',
              'Active accounts ({count})',
              { count: members.length }
            )}
          </h3>
          <button
            type="button"
            onClick={() => void loadMembers()}
            disabled={loading}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            {loading ? tx('Đang tải...', 'Loading...') : tx('Làm mới', 'Refresh')}
          </button>
        </div>

        {loading && members.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            <span>{tx('Đang tải danh sách nhân viên...', 'Loading staff list...')}</span>
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center space-y-1">
            <Users className="h-6 w-6 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-700">
              {tx('Chưa có tài khoản nhân viên nào', 'No staff accounts yet')}
            </p>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
              {tx(
                'Sử dụng biểu mẫu phía trên để tạo tài khoản đăng nhập cho thu ngân hoặc nhân viên phục vụ bàn.',
                'Use the form above to create accounts for cashiers or service staff.'
              )}
            </p>
          </div>
        ) : (
          <ul
            data-testid="shop-members-list"
            className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-2xs"
          >
            {members.map((member) => {
              const busy = busyUserId === member.user_id;
              const isStaff = isShopScopedStaff(member);
              const permsCount = member.permissions?.length || 0;

              return (
                <li
                  key={member.user_id}
                  data-testid={`member-row-${member.user_id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-slate-50/50 transition-colors"
                >
                  {/* Member identity & roles info */}
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-slate-600 shrink-0">
                        {isStaff ? (
                          <User className="h-4 w-4 text-emerald-700" />
                        ) : (
                          <Users className="h-4 w-4 text-slate-500" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {member.username ? (
                            <span className="text-xs font-black text-slate-900 tracking-tight">
                              @{member.username}
                            </span>
                          ) : member.email ? (
                            <span className="text-xs font-black text-slate-900">
                              {member.email}
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-slate-700">
                              {member.user_id}
                            </span>
                          )}

                          {member.full_name && member.username && (
                            <span className="text-xs text-slate-600 font-medium truncate">
                              ({member.full_name})
                            </span>
                          )}

                          {/* Role Badge */}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                              member.role === 'cashier'
                                ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {roleLabel(member.role)}
                          </span>

                          {/* Account Type Badge */}
                          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 border border-slate-200">
                            {isStaff
                              ? tx('Tài khoản quán', 'Shop login')
                              : tx('Email cá nhân', 'Email login')}
                          </span>

                          {/* Status Badge */}
                          {!member.is_active ? (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 border border-amber-200">
                              {tx('Đã tạm khóa', 'Deactivated')}
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              {tx('Hoạt động', 'Active')}
                            </span>
                          )}
                        </div>

                        {/* Additional info or permissions summary */}
                        <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-slate-500">
                          {member.email && member.username && (
                            <span className="mr-2 text-slate-400">
                              {member.email}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 rounded-md px-1.5 py-0.5">
                            <ShieldCheck className="h-3 w-3 text-emerald-600" />
                            <span>
                              {tx(
                                '{count} quyền hạn',
                                '{count} permissions',
                                { count: permsCount }
                              )}
                            </span>
                          </span>
                          {member.permissions?.includes('orders.create') && (
                            <span className="inline-flex items-center text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-1.5 py-0.5">
                              {tx('Tạo đơn tại bàn', 'Table orders')}
                            </span>
                          )}
                          {member.permissions?.includes('payment.collect') && (
                            <span className="inline-flex items-center text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-1.5 py-0.5">
                              {tx('Thu tiền', 'Cashier pay')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions bar */}
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {/* Edit role & permissions button */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleOpenEditModal(member)}
                      data-testid={`edit-member-${member.user_id}`}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
                      title={tx('Sửa vai trò & quyền hạn', 'Edit role & permissions')}
                    >
                      <SlidersHorizontal className="h-3 w-3 text-slate-500" />
                      <span>{tx('Phân quyền', 'Permissions')}</span>
                    </button>

                    {/* Reset Password button (for shop-scoped staff accounts) */}
                    {isStaff && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleOpenResetPassword(member)}
                        data-testid={`reset-password-btn-${member.user_id}`}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
                        title={tx('Đổi mật khẩu tài khoản', 'Reset staff password')}
                      >
                        <Key className="h-3 w-3 text-amber-600" />
                        <span>{tx('Đổi MK', 'Password')}</span>
                      </button>
                    )}

                    {/* Activate/Deactivate toggle button */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleActive(member)}
                      data-testid={`toggle-active-${member.user_id}`}
                      className={`rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
                        member.is_active
                          ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : member.is_active ? (
                        tx('Tạm khóa', 'Deactivate')
                      ) : (
                        tx('Kích hoạt', 'Activate')
                      )}
                    </button>

                    {/* Delete button */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleOpenDeleteConfirm(member)}
                      data-testid={`delete-member-${member.user_id}`}
                      aria-label={tx('Xóa tài khoản nhân viên', 'Delete staff account')}
                      title={tx('Xóa tài khoản nhân viên', 'Delete staff account')}
                      className="rounded-xl border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-60 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Secondary Legacy Email Invite Section */}
      <div className="pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setShowEmailInvite((prev) => !prev)}
          data-testid="toggle-legacy-invite"
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800 transition-colors"
        >
          {showEmailInvite ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          <span>
            {tx(
              'Thêm nhân viên qua email cá nhân (tùy chọn phụ)',
              'Invite member by personal email (secondary)'
            )}
          </span>
        </button>

        {showEmailInvite && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2.5">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {tx(
                'Dành riêng cho nhân viên đã tự đăng ký tài khoản Qlaok bằng email cá nhân trước đó. Nếu không có email, bạn nên dùng chức năng tạo tài khoản tên đăng nhập & mật khẩu ở trên.',
                'For staff members who have already registered their own personal Qlaok email accounts. Otherwise, prefer creating a username/password staff account above.'
              )}
            </p>
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
                placeholder={tx('nhanvien@email.com', 'staff@email.com')}
                aria-label={tx('Email nhân viên', 'Staff email')}
                data-testid="legacy-invite-email"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-hidden"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as ShopRole)}
                aria-label={tx('Vai trò', 'Role')}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-hidden"
              >
                {ASSIGNABLE_STAFF_ROLES.map((role) => (
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
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-60 transition-colors shadow-xs"
              >
                {inviting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                <span>{tx('Gửi lời mời email', 'Add via email')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Role & Permissions Modal */}
      {editingMember && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-staff-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3
                  id="edit-staff-dialog-title"
                  className="text-sm font-extrabold text-slate-900 flex items-center gap-2"
                >
                  <SlidersHorizontal className="h-4 w-4 text-emerald-600" />
                  <span>{tx('Phân quyền & vai trò nhân sự', 'Staff role & permissions')}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingMember.username
                    ? `@${editingMember.username}`
                    : editingMember.full_name || editingMember.email || editingMember.user_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label={tx('Đóng', 'Close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs font-bold text-rose-700"
              >
                {editError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  {tx('Tên hiển thị', 'Display name')}
                </label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  placeholder={tx('Tên nhân viên', 'Staff name')}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  {tx('Vai trò nhân sự', 'Assigned role')}
                </label>
                <div className="flex rounded-xl bg-slate-100 p-0.5">
                  {ASSIGNABLE_STAFF_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleSelectEditRole(r)}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                        editRole === r
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {roleLabel(r)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Permissions list */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800">
                  {tx('Chi tiết quyền hạn được cấp', 'Detailed assigned permissions')}
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    setEditPermissions(DEFAULT_STAFF_ROLE_PERMISSIONS[editRole])
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-emerald-700"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{tx('Đặt lại theo vai trò', 'Reset to role default')}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PERMISSION_CATEGORIES.map((cat) => {
                  const catPerms = STAFF_PERMISSIONS_CONFIG.filter(
                    (p) => p.category === cat.id
                  );
                  return (
                    <div
                      key={cat.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3 space-y-1.5"
                    >
                      <h5 className="text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                        {tx(cat.labelVi, cat.labelEn)}
                      </h5>
                      {catPerms.map((perm) => {
                        const checked = editPermissions.includes(perm.key);
                        return (
                          <label
                            key={perm.key}
                            className={`flex items-start gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                              checked ? 'bg-white shadow-2xs' : 'hover:bg-slate-100/70'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleEditPermission(perm.key)}
                              className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 leading-tight">
                                {tx(perm.labelVi, perm.labelEn)}
                              </p>
                              <p className="text-[10px] text-slate-500 leading-tight">
                                {tx(perm.descVi, perm.descEn)}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditingMember(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {tx('Hủy', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleSaveEditMember()}
                data-testid="save-edit-member"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors shadow-xs"
              >
                {savingEdit ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>{tx('Lưu thay đổi', 'Save changes')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resettingMember && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-password-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 shrink-0">
                <Key className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3
                  id="reset-password-dialog-title"
                  className="text-sm font-extrabold text-slate-900"
                >
                  {tx('Đặt lại mật khẩu nhân viên', 'Reset staff password')}
                </h3>
                <p className="text-xs text-slate-500 truncate">
                  {resettingMember.username
                    ? `@${resettingMember.username}`
                    : resettingMember.full_name || resettingMember.user_id}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>{tx('Lưu ý bảo mật', 'Security notice')}</span>
              </p>
              <p className="text-[11px] leading-relaxed">
                {tx(
                  'Mật khẩu cũ và các phiên đăng nhập hiện tại của tài khoản này sẽ bị chấm dứt ngay lập tức. Nhân viên cần đăng nhập lại với mật khẩu mới.',
                  'The previous password and any active sessions for this account will be invalidated immediately. Staff must log in again with this new password.'
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="reset-staff-new-password-input"
                className="text-xs font-bold text-slate-700"
              >
                {tx('Mật khẩu mới', 'New password')} *
              </label>
              <div className="relative">
                <input
                  id="reset-staff-new-password-input"
                  type={showResetPassword ? 'text' : 'password'}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleConfirmResetPassword();
                    }
                  }}
                  autoComplete="new-password"
                  placeholder={tx('Tối thiểu 6 ký tự', 'At least 6 characters')}
                  data-testid="reset-staff-password-input"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 pr-10 focus:border-emerald-500 focus:bg-white focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  aria-label={
                    showResetPassword
                      ? tx('Ẩn mật khẩu', 'Hide password')
                      : tx('Hiện mật khẩu', 'Show password')
                  }
                >
                  {showResetPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {resetError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs font-bold text-rose-700"
              >
                {resetError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={resetting}
                onClick={() => {
                  setResettingMember(null);
                  setResetError(null);
                  setResetPassword('');
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {tx('Hủy', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => void handleConfirmResetPassword()}
                data-testid="confirm-reset-password"
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-60 transition-colors shadow-xs"
              >
                {resetting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Key className="h-3.5 w-3.5" />
                )}
                <span>{tx('Xác nhận đặt lại', 'Reset password')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingMember && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-staff-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="delete-staff-dialog-title"
                  className="text-sm font-extrabold text-slate-900"
                >
                  {tx('Xóa tài khoản nhân viên', 'Delete staff account')}
                </h3>
                <p className="text-xs text-slate-500">
                  {tx('Hành động này không thể hoàn tác.', 'This action cannot be undone.')}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed font-medium">
              {tx(
                'Bạn có chắc chắn muốn xóa tài khoản {name}? Nhân viên sẽ bị đăng xuất và không thể truy cập vào cửa hàng nữa.',
                'Are you sure you want to remove account {name}? They will be signed out and will lose all access to this shop.',
                {
                  name: deletingMember.username
                    ? `@${deletingMember.username}`
                    : deletingMember.full_name ||
                      deletingMember.email ||
                      deletingMember.user_id,
                }
              )}
            </p>

            {deleteError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs font-bold text-rose-700"
              >
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeletingMember(null);
                  setDeleteError(null);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {tx('Hủy', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                data-testid="confirm-delete-member"
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-500 disabled:opacity-60 transition-colors shadow-xs"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span>{tx('Xác nhận xóa', 'Confirm delete')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
