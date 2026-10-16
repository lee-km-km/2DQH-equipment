# LabStock Ver 1.0

연구실·실험실용 **비품 대여/반납 + 소모품 재고 관리** 웹앱입니다.
서버 없이 정적 파일(HTML/JS/CSS)과 [Supabase](https://supabase.com)만으로 동작하며, Vercel/GitHub Pages 등에 바로 올려 쓸 수 있습니다.

---

## 목차
1. [주요 기능](#1-주요-기능)
2. [권한 정리](#2-권한-정리)
3. [파일 구성](#3-파일-구성)
4. [설치 방법 (처음 쓰는 경우)](#4-설치-방법-처음-쓰는-경우)
5. [이메일 알림 설정 (선택)](#5-이메일-알림-설정-선택)
6. [배포 (Vercel)](#6-배포-vercel)
7. [기존 사용자 업데이트 안내](#7-기존-사용자-업데이트-안내)
8. [동작 확인 체크리스트](#8-동작-확인-체크리스트)
9. [운영 시 주의사항](#9-운영-시-주의사항)
10. [자주 묻는 질문](#10-자주-묻는-질문)
11. [커스터마이징](#11-커스터마이징)

---

## 1. 주요 기능

### 비품
- 비품 목록, 분류 탭, 검색, 대여 가능/대여 중/수리 중 상태 표시
- **대여**: 누구나 가능 (이름, 시작일, 반납 예정일, 메모)
- **반납 처리 / 대여 기록 수정**: 대여한 **본인** 또는 관리자만 가능
- 동일 비품의 중복 대여 방지 (DB 트리거)
- 대여 현황, 대여 이력, 기한 초과 표시

### 소모품
- 소모품 목록, 보관 위치 공유, 최소 보유량 이하 **부족 표시**
- **사용/입고 기록**으로 수량 자동 증감 (DB 함수가 수량과 이력을 한 번에 처리)
- 재고보다 많은 사용 수량은 거부
- 재주문(구매요청) 등록 및 상태 추적

### 알림 (선택)
- 재고가 최소 보유량 이하로 **처음** 내려갈 때 공용 이메일 발송
- 구매요청이 등록되면 즉시 이메일 발송
- Supabase Edge Function + Resend 사용 (API 키는 서버에만 보관)

### 화면
- PC: 대시보드/표 중심의 플랫한 레이아웃
- 모바일(폭 700px 이하): **대여 / 반납 / 구매요청** 큰 버튼 3개만 있는 QR용 홈 화면
  (비품실에 배포 주소 QR을 붙여 두면 편리합니다)

> 수량은 센서로 자동 감지되는 값이 아닙니다. 사람이 사용/입고를 기록하면 DB가 재고를 계산합니다.

---

## 2. 권한 정리

| 기능 | 누구나 | 대여한 본인 | 관리자 |
|---|:-:|:-:|:-:|
| 비품/소모품/대여 현황 조회 | O | O | O |
| 비품 대여 | O | O | O |
| 대여 기록 반납 · 수정 | X | **O** | O |
| 소모품 사용 기록 | O | O | O |
| 소모품 입고 기록 | X | X | O |
| 구매요청 등록 | O | O | O |
| 비품·소모품 등록/수정, 대여 이력, 대시보드 | X | X | O |

- **"본인"의 기준**: 대여할 때 만들어진 익명 로그인 세션(`user_id`)입니다. 대여한 **같은 기기·같은 브라우저**에서만 본인으로 인식됩니다.
- 이 제한은 화면뿐 아니라 DB(RLS)에서도 적용됩니다.

---

## 3. 파일 구성

```
├─ index.html                     화면 구조
├─ style.css                      디자인 (색상 변수는 파일 맨 위)
├─ app.js                         앱 로직 (Supabase URL/키 설정 포함)
├─ supabase.sql                   [신규 설치] 비품/대여 테이블 + 권한(RLS) + 중복대여 방지
├─ consumables_migration.sql      [신규 설치] 소모품/재주문/재고변동 테이블 + 함수
├─ loans_owner_policy.sql         [기존 DB 업데이트용] 본인만 반납·수정 정책
├─ supabase/functions/
│   └─ low-stock-email/index.ts   이메일 알림 Edge Function
├─ index.ts, config.toml          (위 함수 파일의 루트 사본)
└─ README.md                      이 문서
```

---

## 4. 설치 방법 (처음 쓰는 경우)

### 4-1. Supabase 프로젝트 만들기
1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. **Project Settings → API**에서 `Project URL`과 `Publishable(anon) key`를 확인합니다.
3. `app.js` 맨 위의 두 값을 내 프로젝트 값으로 교체합니다.
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'sb_publishable_...';
   ```
   > `service_role` 키는 **절대** 브라우저 코드에 넣지 마세요.

### 4-2. 인증 설정
**Authentication → Providers(또는 Sign In / Providers)**
- **Anonymous Sign-Ins: 켜기** (대여자 본인 식별에 필요)
- **Email: 켜되, 회원가입(Allow new users to sign up)은 끄기** (관리자 계정은 직접 만듭니다)

### 4-3. DB 생성 (순서대로 실행)
**SQL Editor**에서 다음 순서로 파일 내용 전체를 실행합니다.
1. `supabase.sql`
2. `consumables_migration.sql`

> 기존 데이터가 있다면 먼저 백업하세요. `supabase.sql`은 `assets/loans/user_roles`의 기존 정책을 지우고 새로 만듭니다.

### 4-4. 관리자 계정 만들기
1. **Authentication → Users → Add user**로 관리자 이메일/비밀번호 계정을 만듭니다.
2. SQL Editor에서 그 계정을 관리자로 등록합니다.
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'admin@example.com';
   ```
3. 앱 우측 상단 로그인 버튼으로 로그인하면 관리자 기능이 열립니다.

### 4-5. 샘플 데이터
`supabase.sql`에는 예시 비품 4개(EQ-001~004)가 들어 있습니다. 필요 없으면 관리자 화면에서 삭제하세요.

---

## 5. 이메일 알림 설정 (선택)

알림이 필요 없다면 이 장은 건너뛰어도 앱은 정상 동작합니다.

### 5-1. Edge Function 배포
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy low-stock-email --no-verify-jwt
```

### 5-2. Resend 설정
1. [resend.com](https://resend.com)에서 계정을 만들고 발신 도메인을 인증합니다. (테스트 단계에서는 허용된 수신자에게만 발송됩니다.)
2. API Key를 발급합니다.
3. Supabase **Edge Functions → low-stock-email → Secrets**에 등록합니다.

| Secret | 설명 |
|---|---|
| `RESEND_API_KEY` | Resend API 키 |
| `LABSTOCK_ALERT_EMAIL` | 연구실 공용 수신 이메일 |
| `LABSTOCK_WEBHOOK_SECRET` | 임의의 긴 랜덤 문자열 (아래 Webhook 헤더와 동일해야 함) |
| `RESEND_FROM_EMAIL` | 인증된 발신 주소. 예: `LabStock <alerts@your-domain.com>` |

### 5-3. Database Webhook 2개 만들기
**Database → Webhooks**에서 생성합니다. 공통: Type `HTTP Request`, Method `POST`,
URL `https://YOUR_PROJECT_REF.supabase.co/functions/v1/low-stock-email`,
Header `x-labstock-webhook-secret: (LABSTOCK_WEBHOOK_SECRET과 같은 값)`

| 용도 | Table | Events |
|---|---|---|
| 재고 부족 알림 | `public.consumables` | INSERT, UPDATE |
| 구매요청 즉시 알림 | `public.reorder_requests` | INSERT |

재고 부족 알림은 "충분 → 부족"으로 **바뀔 때만** 발송되며, 이미 부족한 품목을 수정해도 반복 발송하지 않습니다. 재고를 보충한 뒤 다시 부족해지면 새로 발송됩니다.

---

## 6. 배포 (Vercel)

1. 이 폴더의 파일을 GitHub 저장소 **루트**에 올립니다. (`index.html`, `style.css`, `app.js`, SQL 파일, `README.md`, `supabase/`)
2. Vercel에서 저장소를 Import합니다. Framework는 `Other`(정적 사이트)로 두고, **Root Directory**가 위 파일이 있는 폴더인지 확인합니다.
3. 배포 후 `Ctrl + F5`로 강력 새로고침해 최신 파일이 반영됐는지 확인합니다.
4. 배포 주소를 QR로 만들어 비품실에 붙입니다.

---

## 7. 기존 사용자 업데이트 안내

### 이전 버전(누구나 반납 가능 / 관리자만 반납 가능)에서 올리는 경우
1. 새 `index.html`, `style.css`, `app.js`로 교체하고 재배포합니다. (`app.js`의 Supabase 값은 유지)
2. SQL Editor에서 **`loans_owner_policy.sql`을 한 번 실행**합니다.
   - 실행하지 않으면 화면에서만 막히고 DB에서는 여전히 누구나 수정할 수 있습니다.
3. 소모품 기능을 아직 설치하지 않았다면 `consumables_migration.sql`도 실행합니다. (이미 설치된 경우에도 안전하게 재실행 가능)
4. 이메일 알림을 쓰는 중이라면 Edge Function을 다시 배포합니다.

### 참고
- `user_id`가 없는 **예전 대여 기록**은 관리자만 반납·수정할 수 있습니다.

---

## 8. 동작 확인 체크리스트

**비품**
- [ ] 비품을 대여하면 목록에 "대여 중"으로 표시됨
- [ ] 같은 기기에서 `대여 현황`의 `수정`, `반납 처리`가 보임
- [ ] 다른 기기/시크릿 창에서는 그 기록의 버튼이 `—`로 보임
- [ ] 이미 대여 중인 비품은 중복 대여가 거부됨
- [ ] 관리자는 모든 기록을 반납·수정할 수 있음

**소모품**
- [ ] 소모품 등록 (관리자)
- [ ] 사용 기록 저장 시 수량 감소 및 이력 생성
- [ ] 입고 기록 저장 시 수량 증가 (관리자)
- [ ] 재고보다 큰 사용 수량은 거부됨
- [ ] 최소 보유량 이하가 되면 "부족" 표시

**알림 (설정한 경우)**
- [ ] 재고 부족 시 공용 이메일 수신
- [ ] 구매요청 시 `[LabStock 구매요청]` 메일 수신

---

## 9. 운영 시 주의사항

- **조회와 대여는 공개 모델입니다.** 배포 주소를 아는 사람은 누구나 목록을 보고 대여할 수 있으므로, 연구실 내부 구성원에게만 주소/QR을 공유하세요. 더 엄격한 통제가 필요하면 로그인 필수 구조로 바꾸는 것을 권장합니다.
- 본인 확인은 "같은 브라우저 세션" 기준이라 **이름 입력만으로는 본인 확인이 되지 않습니다.** 대여자 이름은 표시용입니다.
- Webhook Secret, Resend API Key는 서버 Secret으로만 관리하세요. HTML/JS에 넣지 마세요.
- 이메일은 Resend의 발신 도메인/계정 정책을 따릅니다. 설정 전에는 코드만 배포해도 메일이 발송되지 않습니다.
- SQL 실행 전에는 DB 백업을 권장합니다.

---

## 10. 자주 묻는 질문

**Q. 반납 버튼이 안 보이거나 "본인이 대여한 기록만…" 메시지가 나옵니다.**
대여한 기기/브라우저가 아니기 때문입니다. 대여했던 기기에서 처리하거나 관리자가 대신 처리하세요.

**Q. 브라우저 데이터를 지웠더니 내가 빌린 기록을 반납할 수 없습니다.**
익명 세션이 사라져 본인 연결이 끊긴 것입니다. 관리자에게 반납 처리를 요청하세요.

**Q. 대여 시 "로그인 세션을 생성하지 못했습니다"가 나옵니다.**
Supabase에서 **Anonymous Sign-Ins**가 꺼져 있습니다. 4-2 단계를 확인하세요.

**Q. 소모품 메뉴가 비어 있거나 오류가 납니다.**
`consumables_migration.sql`을 실행했는지 확인하세요.

**Q. 관리자로 로그인했는데 관리자 메뉴가 안 보입니다.**
`user_roles`에 해당 계정이 등록되었는지(4-4 단계) 확인하세요.

---

## 11. 커스터마이징

- **색상/디자인**: `style.css` 맨 위의 CSS 변수(`--accent` 등)
- **글꼴**: Pretendard(CDN). 불러오지 못하면 시스템 글꼴로 대체
- **분류 목록**: `app.js`의 `TOP_LEVEL_CATEGORIES` 및 분류 판별 규칙
- **모바일 홈 전환 폭**: 기본 700px 이하

---

LabStock Ver 1.0
