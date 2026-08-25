---
schema_version: "1.0"
id: multichannel-repurposing-db
entity_type: context
scope: company
title: 멀티채널 확장 Runtime DB Schema
status: active
version: 1
updated_at: 2026-08-25T12:00:00+09:00
updated_by: ricky
---

# Runtime DB Schema v1.0

고빈도 실행 상태와 성과는 Git이 아니라 Supabase Postgres에 둔다.

| Table | 핵심 컬럼 | 역할 |
|---|---|---|
| `repurposing_runs` | id, content_id, pipeline_version, status, trigger_at | 확장 Run |
| `repurposing_stage_runs` | run_id, stage_id, status, attempt, job_id, error | 15개 Stage 상태 |
| `content_atoms` | atom_id, content_id, source_timecode, claim, channel_fit, risk | Atom 검색·배정 |
| `channel_outputs` | run_id, channel, atom_ids, version, payload, asset_id, status | 채널 결과 버전 |
| `publish_schedules` | output_id, channel, publish_at, timezone, status | 예약 Queue |
| `publish_receipts` | output_id, external_id, url, published_at | 외부 게시 영수증 |
| `metric_snapshots` | receipt_id, window, metric_key, value, measured_at | 1h·24h·7d·30d |
| `learning_records` | content_id, atom_id, hypothesis, result, reusable_rule | 다음 Run 학습 |
| `oauth_connections` | provider, account_id, token_ref, expires_at, status | Vault 참조만 저장 |

모든 실행은 `(run_id, stage_id, attempt)`와 idempotency key로 중복 게시를 방지한다.
