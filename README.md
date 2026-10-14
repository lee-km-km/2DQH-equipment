# LabStock v1 — 연구실 비품 대여 관리

모바일·PC 브라우저에서 사용하는 간단한 공용 비품 관리 웹앱입니다. 데이터는 브라우저 로컬 저장소가 아니라 Supabase PostgreSQL에 저장되므로 여러 기기에서 공유됩니다.

## 포함 기능
- 비품 검색(비품명·식별번호·분류·보관 위치)
- 비품 등록/수정(관리자)
- 대여자 이름 직접 입력, 대여 시작일·반납 예정일 기록
- 현재 대여 현황 및 대여 이력
- 실제 반납일 기록(관리자)
- CSV 이력 내보내기
- 반응형 모바일/PC UI

## 무료 호스팅 구성
- **Supabase**: 공유 데이터베이스 및 관리자 인증
- **Vercel**: 웹사이트 배포
- 개인별 계정 없이 대여자 이름을 직접 입력할 수 있습니다. 단, 이름은 본인 확인 수단이 아닙니다.

## 1. Supabase 데이터베이스 만들기
1. https://supabase.com 에서 프로젝트를 생성합니다. 프로젝트 비밀번호는 따로 안전하게 보관합니다.
2. 프로젝트의 **SQL Editor**를 엽니다.
3. `supabase.sql` 전체 내용을 붙여넣고 실행합니다.
4. **Authentication → Users**에서 관리자 사용자를 직접 생성합니다. 프로젝트 설정에서 공개 회원가입(Sign ups)을 비활성화하고, 관리자 계정만 사용하세요.
5. **Project Settings → API**(또는 Connect 화면)에서 Project URL과 `anon`/publishable public key를 복사합니다. `service_role`/secret key는 절대 웹페이지에 넣지 않습니다.

## 2. 앱에 Supabase 연결 정보 넣기
`app.js` 맨 위의 다음 두 값을 바꿉니다.
```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```
Supabase URL과 공개 anon/publishable key를 넣은 뒤 저장합니다. 공개 키는 RLS 정책과 함께 쓰도록 설계된 키입니다. 비밀 `service_role` 키는 사용하지 마세요.

## 3. GitHub에 업로드
1. GitHub에서 새 저장소(repository)를 만듭니다. 예: `labstock-v1`.
2. 이 폴더 안의 `index.html`, `style.css`, `app.js`, `supabase.sql`, `README.md` 파일을 저장소 루트에 업로드합니다.

## 4. Vercel에 게시
1. https://vercel.com 에 로그인하고 **Add New → Project**를 선택합니다.
2. GitHub 저장소 `labstock-v1`를 가져옵니다.
3. Framework Preset은 **Other**, Build Command는 비워두고 Output Directory는 `.` 또는 기본값으로 설정합니다.
4. Deploy를 누릅니다. 배포가 끝나면 `https://...vercel.app` 주소가 생기며, 그 주소를 연구실 구성원에게 공유하면 됩니다.

## 권한 모델 및 운영 전 확인
- 누구나 비품/대여 이력을 볼 수 있고, 이름을 입력해 대여 기록을 등록할 수 있습니다.
- 비품 추가·수정, 반납 처리는 관리자 로그인 후에만 가능합니다.
- SQL 정책상 공개 대여 입력은 허용됩니다. 링크를 아는 사람이 임의 이름으로 기록을 남길 가능성이 있으므로, 처음에는 소규모로 시험 운영하세요. 외부에 공개된 환경에서 악용 방지까지 필요하다면 공용 PIN/초대 코드 또는 승인 대기 절차를 추가해야 합니다.
- 대여자 이름과 대여 이력이 공개되므로 기관 규정과 개인정보 처리 기준을 확인하세요. 외부 인터넷에 공개하기 전 관리자 승인 및 접근 범위를 검토하는 것을 권장합니다.
- V1은 단순한 초기 버전입니다. 비품 삭제, 이미지/바코드, 감사 로그, 자동 알림, 정교한 역할 권한은 아직 없습니다.

## 로컬 미리보기
`index.html`을 브라우저에서 열 수 있지만, Supabase 설정이 없으면 공용 데이터가 표시되지 않습니다. 배포 후 정상 연결 여부를 확인하세요.


## 권한 설정 (익명 사용자 세션 + 관리자 계정)
1. Supabase Authentication 설정에서 **Anonymous Sign-Ins**를 활성화합니다. 일반 사용자는 로그인 화면 없이 기기별 익명 세션을 자동 생성합니다.
2. 기존 데이터베이스를 백업한 뒤, 새 `supabase.sql`을 SQL Editor에서 실행합니다. 이 스크립트는 필요한 테이블을 생성하고, `assets`, `loans`, `user_roles`의 기존 RLS 정책을 정리한 뒤 새 정책을 만듭니다. 기존 대여 기록의 `user_id`는 비워 두므로 관리자만 볼 수 있습니다. 기존 대여 기록의 `user_id`는 비워 두므로 관리자만 볼 수 있습니다.
3. Authentication → Users에서 관리자 계정 UUID가 `b8be6f76-9b52-4a3b-b18f-77f67b0d2eb3`인지 확인합니다. 해당 사용자가 실제로 존재할 때 아래 SQL을 별도로 실행해 관리자 권한을 부여합니다.

```sql
insert into public.user_roles (user_id, role)
values ('b8be6f76-9b52-4a3b-b18f-77f67b0d2eb3', 'admin')
on conflict (user_id) do update set role = 'admin';
```

4. `app.js`의 Supabase URL과 공개 anon/publishable key를 기존 프로젝트 값으로 유지합니다. `service_role`/secret key는 브라우저 코드에 넣지 않습니다.
5. 일반 사용자는 자기 대여 기록만 조회·수정·반납 처리할 수 있습니다. 비품 목록에는 타인의 대여자 이름을 노출하지 않고, `get_asset_availability()` RPC를 통해 대여 가능 여부만 표시합니다. 관리자는 관리자 역할이 확인된 경우에만 전체 대여 기록과 비품을 관리합니다.
6. 익명 세션은 브라우저별로 유지됩니다. 브라우저 데이터 삭제·기기 변경 시 이전 대여 기록을 자동으로 복구할 수 없습니다. 익명 사용자 세션을 탈취한 경우 해당 사용자로 가장할 수 있으므로 공용 PC에서는 사용 후 브라우저 데이터를 관리하세요.
