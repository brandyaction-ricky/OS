---
schema_version: "1.0"
id: wiki-company-os-knowledge-model-v2
entity_type: wiki
wiki_id: os-knowledge-model
wiki_type: company
category: operating_system
owner: ricky
title: 개인 Obsidian과 회사 OS 연결 구조
status: active
version: 2
is_latest: true
source_ids: [decision-personal-obsidian-company-wiki-2026-08-24]
promoted_by: ricky
promoted_at: 2026-08-24T10:40:00+09:00
created_at: 2026-08-24T10:40:00+09:00
updated_at: 2026-08-24T10:40:00+09:00
updated_by: ricky
---

# 개인 Obsidian과 회사 OS 연결 구조

## 개인 맥락 관리

각 직원은 자신의 Obsidian에서 Raw, 개인 Wiki와 AI 작업 맥락을 자유롭게 관리한다. Raw는 기억하고 싶은 인사이트를 빠르게 던지는 개인 영역이며 회사 OS에 저장하지 않는다.

## 회사 OS

회사 OS에는 공정에서 반복 사용해야 하는 최신 Wiki, 직원별 담당 업무, Content Run 상태와 결과물 버전만 저장한다. 개인 Wiki 중 회사 공정에 필요한 내용만 공유 Wiki로 연결한다.

## OS Access Skill

Skill은 업무를 대신 수행하거나 정본을 보관하지 않는다. 현재 공정에 필요한 최신 Company Wiki, Content Run과 입력 데이터를 찾아 각 직원의 AI에 전달하는 Context Loader다.

## 공정 실행

각 직원의 AI는 Access Skill이 불러온 최신 Wiki를 참고해 결과물을 만든다. 사람은 필요한 의사결정을 하고 결과물은 Content Run에 새 버전으로 기록한다.

## 운영 원칙

- 개인 Raw와 개인 전용 Wiki는 개인 Obsidian에 둔다.
- 회사 OS에는 공유하기로 선택한 최신 Wiki만 둔다.
- 공정의 실무 기준은 Process Wiki에서 최신화한다.
- Skill은 Context를 불러오고 실제 실행과 판단은 각자의 AI와 사람이 한다.
- 모든 Work Package는 사용한 Wiki의 경로와 버전을 포함한다.
