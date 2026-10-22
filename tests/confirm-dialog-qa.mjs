// Server-renders the shared ConfirmDialog to verify accessible markup (run via confirm-dialog-review.test.ts).
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog.tsx';

const noop = () => {};
const html = renderToStaticMarkup(
  React.createElement(ConfirmDialog, {
    open: true,
    variant: 'danger',
    title: 'Hủy đơn #A1?',
    description: 'Không thể hoàn tác',
    reason: { label: 'Lý do hủy', required: true },
    checkbox: { label: 'Hoàn lại tồn kho các món', defaultChecked: true },
    error: 'Lỗi máy chủ',
    onConfirm: noop,
    onCancel: noop,
  })
);

const checks = [
  ['dialog element', /<dialog[^>]*aria-labelledby="[^"]+"/],
  ['title rendered', /Hủy đơn #A1\?/],
  ['required reason textarea', /<textarea[^>]*required=""/],
  ['restock checkbox checked', /<input[^>]*type="checkbox"[^>]*checked=""/],
  ['danger confirm button', /bg-rose-600/],
  ['confirm disabled until reason entered', /<button[^>]*type="submit"[^>]*disabled=""/],
  ['inline error alert', /role="alert"[^>]*>Lỗi máy chủ/],
];
for (const [name, re] of checks) {
  if (!re.test(html)) {
    console.error(`FAIL: ${name}\n${html}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

const closed = renderToStaticMarkup(
  React.createElement(ConfirmDialog, { open: false, title: 'X', onConfirm: noop, onCancel: noop })
);
if (/<form/.test(closed)) {
  console.error('FAIL: closed dialog should not render its form');
  process.exit(1);
}
console.log('PASS: closed dialog renders no form');
