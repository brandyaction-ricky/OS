# Content DNA Schema v1.0

`CONTENT_DNA.md`는 롱폼 정본에서 모든 파생 콘텐츠가 공통으로 읽는 맥락 계약이다.

```yaml
schema_version: "1.0"
entity_type: content_dna
content_id: BA-0000
source_assets: [final_master, clean_srt, approved_script, youtube_assets]
core_promise: "시청자에게 주는 한 가지 약속"
target_problem: "해결하는 문제"
main_claims: []
evidence: []
hooks: []
cta: "다음 행동"
brand_tone: "브랜디액션"
risk_claims: []
status: draft
version: 1
```

주장과 근거는 ID로 연결하고, 확인되지 않은 사실은 `risk_claims`에 남긴다. 채널별 카피가 정본의 약속을 바꾸면 검증 실패다.
