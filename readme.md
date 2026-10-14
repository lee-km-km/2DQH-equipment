# LabStock v1 — 연구실 비품 대여 관리

모바일·PC 브라우저에서 사용하는 간단한 공용 비품 관리 웹앱입니다. 데이터는 브라우저 로컬 저장소가 아니라 Supabase PostgreSQL에 저장되므로 여러 기기에서 공유됩니다.

## 포함 기능
- 비품 검색(비품명·식별번호·분류·보관 위치)
- 비품 등록/수정 (관리자 전용)
- 대여자 이름 직접 입력, 대여 시작일·반납 예정일 기록 (익명/일반 사용자 모두 가능)
- 전체 대여 현황 및 대여 이력 조회 (누구나 전체 로그 확인 가능)
- 실제 반납일 기록 및 대여 기록 수정 (익명/일반 사용자 및 관리자 모두 가능)
- CSV 이력 내보내기
- 반응형 모바일/PC UI

## 무료 호스팅 구성
- **Supabase**: 공유 데이터베이스 및 관리자 인증
- **Vercel**: 웹사이트 배포
- 개인별 별도 로그인 계정 없이 대여자 이름을 직접 입력하여 간편하게 대여할 수 있습니다. 단, 이름 입력은 본인 확인 수단이 아니므로 연구실 내부 공용으로 사용하기 적합합니다.

## 1. Supabase 데이터베이스 만들기
1. https://supabase.com 에서 프로젝트를 생성합니다. 프로젝트 비밀번호는 안전한 곳에 보관합니다.
2. 프로젝트의 **SQL Editor**를 엽니다.
3. 수정된 `supabase.sql` 전체 내용을 붙여넣고 실행합니다. (익명 사용자의 전체 조회·반납 권한이 포함된 스크립트입니다.)
4. **Authentication → Users**에서 관리자 사용자를 직접 생성합니다. 프로젝트 설정에서 공개 회원가입(Sign ups)을 비활성화하고 관리자 계정만 관리하세요.
5. **Project Settings → API**에서 Project URL과 `anon`/publishable public key를 복사합니다. `service_role`/secret key는 절대 웹페이지에 넣지 않습니다.

## 2. 앱에 Supabase 연결 정보 넣기
`app.js` 맨 위의 다음 두 값을 본인의 Supabase 정보로 변경합니다.
```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';