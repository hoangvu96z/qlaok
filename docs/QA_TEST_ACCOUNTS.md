# QA test accounts

Updated **24/10/2026**. These accounts belong to the user-provided QA shop and are for authorized product testing.

## Shop owner

- Shop: `test shop 1`
- Production URL: `https://qlaok.vunph.click`
- Login: `hvtekshop@gmail.com`
- Local credential file: `.env.testing` at the repository root. This file is Git-ignored; never copy its password into tracked docs, commits, screenshots, or logs.

Expected local keys:

```dotenv
QA_BASE_URL=https://qlaok.vunph.click
QA_SHOP_NAME="test shop 1"
QA_OWNER_EMAIL=hvtekshop@gmail.com
QA_OWNER_PASSWORD=
```

## Staff accounts

The shop currently has these active staff logins:

| Username | Role | UI status |
| --- | --- | --- |
| `nhanvien1` | Nhân viên | Hoạt động |
| `thungan1` | Thu ngân | Hoạt động |

Staff passwords were not provided in the account screenshots. Do not assume they match the owner password; retrieve or reset them through the shop owner account when a staff-specific login test needs them.

## QA handling

- Use this shop for the owner/staff/mobile order flows when production QA is explicitly in scope.
- Keep `.env.testing` local and restrict its permissions (`chmod 600 .env.testing`).
- Do not commit production credentials, place them in CI variables through a repository file, or print them in command output.
- Avoid creating real payments. Use a clearly identifiable low-value test order and clean it up or cancel it when the test permits.
