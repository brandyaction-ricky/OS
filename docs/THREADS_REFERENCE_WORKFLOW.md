# Threads reference workflow

The reference workspace at `/automation/references` collects observations made by a person or Aside. It does not crawl Threads or Substack, infer engagement, or publish content.

## Operator flow

1. Open **콘텐츠 자동화 → 레퍼런스**. Copy the research instruction to Aside or register a source directly.
2. Record the source URL, author, dates, visible metrics, reading scope, scene, reader question and proposed perspective. An unavailable metric stays unknown; an observed zero remains zero.
3. Compare sources and choose the ones to use. **주제 후보로 가져오기** creates a separate topic with copies of those source observations.
4. Review the topic brief, select Threads and start production. Raw source records cannot directly start drafting.
5. Request an AI draft. The job pins the company's readable canonical document, its version and examples, the selected source observations, the parent brief, and any selected personal skill version.
6. Use the worker screen or copy its instructions to Aside. Save the returned result as **미승인**. Human adoption, team review and final confirmation continue through the existing controls.

Reference collection remains personal. Only the selected evidence follows the topic and draft; sharing a draft does not expose the entire private collection. Archiving a source does not remove evidence already copied into a topic.

## Reliability

- Existing `content_topic` metadata stores references. No migration or access-policy change is included.
- A normalized source URL provides duplicate-request identity. Updating a duplicate URL returns a conflict rather than silently replacing another source.
- The server resolves one accessible company canonical by exact title and canonical status. Missing, ambiguous, non-company-readable or unsupported documents stop the job.
- Jobs intentionally retain the canonical version read at creation. A new document revision applies to new jobs; it does not silently rewrite running work.
- Topic, source or draft changes invalidate the old input. Legacy Threads jobs without the canonical input must be closed and recreated.
- Permanent input failures block the affected queued job and allow other jobs to continue. Temporary failures preserve the queue for retry.
- AI-generated topic candidates inherit evidence from the user's completed source job, not replacement evidence sent by the client.
- General record APIs cannot create or mutate these protected personal AI jobs. The dedicated automation APIs own their snapshots.

## Validation boundaries

Unit and mocked route tests exercise ownership, source selection, canonical snapshots, stale input, queue behavior and protected writes. Browser tests cover desktop/mobile layout and mocked source-to-topic / instruction-copy flows. Mock tests do not verify a real employee session, production database permissions, Aside execution or model output quality.

Before production rollout, test with an authorized development account and verified development data. Do not use production records as test fixtures. This change adds neither automatic approval nor posting/scheduling actions.

## Rollback

Revert the feature commit through the normal reviewed deployment path. Existing records remain compatible metadata records; no schema rollback is required. Collected source records should be retained rather than deleted. The separately versioned company canonical document is not reverted by a code rollback.
