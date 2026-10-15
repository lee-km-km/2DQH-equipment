# LabStock — UI 리뉴얼 + 소모품 재고/이메일 알림

이 프로젝트는 기존 비품 대여/반납 흐름을 유지하면서 소모품 관리와 재고 이동 기록을 추가합니다.

## 포함 기능
- 리뉴얼된 대시보드/탐색 메뉴/카드/테이블 및 모바일 대응
- 비품 대여·반납·이력 유지
- 별도 소모품 메뉴, 연구실 내 보관 위치 공유
- 소모품별 사용/입고 기록으로 수량 자동 차감·증가 (원자적 DB 함수)
- 사용/입고 이력 및 재주문 요청 상태 추적
- 재고가 최소 보유량 이하로 처음 내려갈 때 공용 이메일로 알림
- Supabase Edge Function: `supabase/functions/low-stock-email/index.ts`

> 수량은 센서가 실물을 자동 감지하는 값이 아닙니다. 사용/입고 수량을 사람이 기록하면 DB가 공유 재고를 자동으로 계산합니다.

## A. Supabase DB 마이그레이션
1. Supabase Dashboard → SQL Editor를 엽니다.
2. `consumables_migration.sql` 전체 내용을 실행합니다. 이미 이전 버전의 소모품 기능을 설치했어도 이 파일은 기존 테이블을 유지하며 재고 변동 테이블/함수를 추가합니다.
3. 소모품 추가/수정은 관리자 로그인 권한이 필요합니다. 사용/입고 기록은 `record_consumable_movement` DB 함수가 수량과 이력을 한 트랜잭션으로 갱신합니다.

## B. Edge Function 배포
Supabase CLI를 설치하고 프로젝트 루트에서 로그인/프로젝트 연결 후:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy low-stock-email --no-verify-jwt
```

이 프로젝트의 Supabase URL/공개 키는 기존 `app.js` 설정을 유지합니다. `service_role` 키를 브라우저 코드에 넣지 마세요.

## C. Resend 이메일 설정
1. https://resend.com 에서 계정을 만들고 발신 도메인을 인증합니다. 테스트 단계에서는 Resend가 허용한 테스트 수신자만 받을 수 있습니다.
2. Resend API Key를 생성합니다.
3. Supabase Dashboard → Edge Functions → `low-stock-email` → Secrets(또는 Project Settings → Edge Function Secrets)에 다음 값을 등록합니다.
   - `RESEND_API_KEY`: Resend API 키
   - `LABSTOCK_ALERT_EMAIL`: 연구실 공용 수신 이메일 주소
   - `LABSTOCK_WEBHOOK_SECRET`: 임의의 긴 랜덤 문자열(아래 Webhook 헤더와 완전히 동일하게)
   - `RESEND_FROM_EMAIL`: 인증된 발신 주소, 예: `LabStock <alerts@your-verified-domain.com>`
4. `LABSTOCK_WEBHOOK_SECRET`은 공개하거나 HTML/JS 파일에 넣지 마세요.

## D. DB Webhook 연결 (서버에서 이메일 자동 발송)
1. Supabase Dashboard → Database → Webhooks에서 새 webhook을 만듭니다.
2. Table: `public.consumables`; Events: **INSERT**, **UPDATE** 선택.
3. Type: HTTP Request, Method: POST, URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/low-stock-email`.
4. Header 추가: `x-labstock-webhook-secret: (LABSTOCK_WEBHOOK_SECRET과 같은 값)`.
5. 저장하고 테스트할 소모품 하나의 수량을 최소 보유량보다 높게 둔 다음, 사용 기록으로 최소 보유량 이하가 되도록 내려 봅니다.

Webhook은 서버에서 Edge Function을 호출하므로 Resend API 키가 브라우저에 노출되지 않습니다. 알림은 새 소모품이 이미 부족한 상태로 생성되거나, 충분한 재고에서 부족 상태로 바뀔 때 전송합니다. 이미 부족 상태인 품목의 일반 수정으로 반복 발송하지 않습니다. 부족 상태에서 재고를 보충한 후 다시 부족 상태로 내려가면 새 알림이 전송됩니다.

## D-2. 구매요청 즉시 메일 (reorder_requests 웹훅)
구매요청이 들어오면 재고와 상관없이 바로 메일이 가도록 웹훅을 하나 더 만듭니다.
1. 위 B 단계의 Edge Function을 **다시 배포**합니다: `supabase functions deploy low-stock-email --no-verify-jwt`
2. Dashboard → Database → Webhooks → 새 webhook 생성
   - Table: `public.reorder_requests`, Events: **INSERT** 만 선택
   - Type: HTTP Request, Method: POST, URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/low-stock-email` (D 단계와 같은 주소)
   - Header: `x-labstock-webhook-secret: (D 단계와 같은 값)`
3. 앱에서 구매요청을 한 번 보내 `LABSTOCK_ALERT_EMAIL` 수신함에 `[LabStock 구매요청]` 메일이 오는지 확인합니다.

기존 `consumables` 웹훅(재고 부족 알림)은 그대로 유지됩니다. 품목 정보는 Edge Function이 서버에서 조회하므로 추가 Secret은 필요 없습니다(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 자동 제공).

## 모바일 QR 홈 화면
휴대폰 화면(폭 700px 이하)으로 접속하면 먼저 **대여 / 반납 / 구매요청** 큰 버튼 3개만 보이는 홈이 열립니다. 저장하거나 닫으면 홈으로 돌아오고, 상단 메뉴의 `홈`으로도 돌아올 수 있습니다. PC 화면은 기존 대시보드 그대로입니다. 비품실 QR에는 배포된 Vercel 주소를 그대로 넣으면 됩니다.

## 디자인 메모
- 단색 배경 + 포인트 색 하나(`--accent`), 카드 대신 표와 구분선 중심의 플랫한 스타일입니다. 색은 `style.css` 맨 위 변수에서 바꿉니다.
- 글꼴은 Pretendard(CDN)를 쓰며, 불러오지 못하면 시스템 글꼴로 대체됩니다.
- 휴대폰에서는 입력 창이 화면 아래에서 올라오는 시트로 열립니다.

## E. GitHub/Vercel 배포
1. ZIP을 풀고 `index.html`, `style.css`, `app.js`, `supabase.sql`, `consumables_migration.sql`, `README.md`, `supabase/` 폴더를 저장소 루트에 업로드/교체합니다.
2. Vercel Project Settings → General → Root Directory가 이 파일들이 있는 폴더를 가리키는지 확인합니다.
3. Deployments에서 최신 커밋을 재배포합니다.
4. 배포된 URL에서 `Ctrl + F5`로 강력 새로고침합니다. GitHub의 파일뿐 아니라 Vercel의 실제 배포 커밋도 확인하세요.

## 동작 확인 체크리스트
- [ ] 대시보드가 새 레이아웃으로 보임
- [ ] 소모품 메뉴가 나타남
- [ ] 소모품 등록 (관리자)
- [ ] 사용 기록을 저장하면 수량이 감소하고 기록이 생성됨
- [ ] 입고 기록을 저장하면 수량이 증가하고 기록이 생성됨
- [ ] 재고보다 큰 사용 수량은 거부됨
- [ ] 최소 보유량 이하로 내려가면 대시보드/목록에서 부족 표시
- [ ] DB Webhook 및 Resend 설정 후 공용 이메일 수신 확인

## 운영 보안 메모
- 소모품 재고 조회/사용·입고 기록은 현재 공유 연구실 앱의 공개 접근 모델을 따릅니다. 링크를 가진 사용자가 기록을 남길 수 있으므로 내부 구성원에게만 URL을 공유하고, 운영 환경에서는 로그인/권한 제한을 고려하세요.
- DB Webhook secret과 Resend API key는 서버 secret으로만 관리하세요.
- 이메일 전송은 Resend의 발신 도메인/계정 정책에 따릅니다. 서비스 설정 전에는 코드만 배포해도 이메일이 자동 발송되지는 않습니다.
