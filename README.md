# QR-Order-NR Integrated (iron-session)

## What’s included
- Single Vercel project (API + Admin + App)
- iron-session cookie auth (no external calls)
- Namespaced statics:
  - /static/admin/* → public/admin/*
  - /static/app/* → public/app/*
- Pages:
  - /store, /delivery, /delivery/home, /payment/success, /payment/fail
  - /admin (requires login), /login
- APIs:
  - Auth: POST /api/admin/login, POST /api/admin/logout, GET /api/admin/me
  - Menu: GET /menu, POST /menu (admin), PUT /menu/:id (admin), DELETE /menu/:id (admin)
  - Orders: GET /orders (admin), POST /orders (public), POST /confirm (admin)
  - Health: GET /healthz

## Env
- SESSION_PASSWORD (>=32 chars)
- ADMIN_USER (default: admin)
- ADMIN_PASS (default: admin1234)

## Vercel
- `vercel.json` rewrites all routes to `/api`
- `api/index.js` exports Express app

## Notes
- Existing admin & order public files were merged into /public/{admin,app}
- Extend endpoints as needed by porting over legacy handlers


## Added in v2
- Toss Payments:
  - `GET /payment/config` → 클라이언트에 clientKey 제공
  - `POST /payment/confirm` → 서버에서 결제 검증/확정 (TOSS_SECRET_KEY 필요)
- Public bank info:
  - `GET /bank-info/public` → 은행/계좌/예금주
- Staff call stub:
  - `POST /call-staff`
- Admin config:
  - `GET /admin-config` (admin)


## v3 Additions
- **Excel 내보내기**: `GET /export/orders.xlsx` (admin)
- **메뉴 일괄 업로드**: `POST /import/menu?mode=replace|append` (admin) + multipart/form-data (field: `file`), CSV/XLSX 지원
  - 컬럼: id, name, price, cat, active
- **관리자 이벤트 스트림(SSE)**: `GET /events/orders` (admin)
  - 신규 주문(`created`), 확정(`confirmed`) 이벤트 전송
