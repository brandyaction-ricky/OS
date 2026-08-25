# Content Atom Schema v1.0

```json
{
  "atomId": "BA-0000-A01",
  "contentId": "BA-0000",
  "type": "claim|case|howto|quote|data|cta",
  "sourceTimecode": { "start": "00:00:00", "end": "00:00:45" },
  "claim": "재사용할 핵심 메시지",
  "evidenceIds": ["E01"],
  "hookCandidates": [],
  "channelFit": { "shorts": 0, "carousel": 0, "threads": 0 },
  "visualPotential": "low|medium|high",
  "risk": "none|fact_check|legal|brand",
  "status": "candidate|selected|rejected"
}
```

Atom은 원본 타임코드와 근거를 잃지 않는다. 채널 결과는 반드시 사용한 `atomId`를 기록한다.
