# 오뱅알 정책 문서

- 서비스: /mobile/lol.html
- 방송 일정: /mobile/index.html
- 이용약관: /mobile/about/terms.html
- 개인정보처리방침 초안 및 문의 안내: /mobile/about/privacy.html

소개·체험·심사 안내 페이지는 제거했습니다.

배포: powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./package-mobile-site.ps1
Riot에서 발급한 인증 토큰 파일은 -RiotVerificationFile PATH로 지정하면 배포 루트의 riot.txt에 포함됩니다. 토큰에는 앞뒤 공백이나 개행이 없어야 하며 API 키를 넣으면 안 됩니다.
