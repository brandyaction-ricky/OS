# KOSIS read-only statistics integration

## Scope

The OS calls the official KOSIS API directly. No third-party MCP server, new database table, model invocation, document persistence, or automatic content generation is introduced. Existing authentication is required; active users and AI keys with knowledge.read can query. A key belongs only in the server's KOSIS_API_KEY environment variable. Missing configuration returns 503 rather than fabricated demo statistics.

POST /api/v1/statistics/kosis supports:

- Search: {"action":"search","query":"자영업자","page":1,"limit":10}
- Metadata: {"action":"metadata","orgId":"101","tblId":"<table ID from search>","type":"ITM"}. Also supports TBL, ORG, PRD, UNIT, SOURCE.
- Data: supply the exact orgId, tblId, itmId, objL1 and optional objL2–objL8 from metadata, prdSe, and newEstPrdCnt (1–12 recent observations). Select only the categories needed; avoid ALL for large tables.

The existing remote OS MCP exposes query_statistics with the same inputs. Connectors must refresh their tool inventory after deployment. The legacy Python knowledge-only connector is unchanged. No new statistics screen is added in this API-first increment.

## Content use

Search returns candidate tables, not verified numerical claims. Check ITM, PRD, UNIT and SOURCE metadata before fetching values. Keep each value with its period, unit, dimensions, source URL and retrieval time; distinguish population-level observations from interpretations about individual motivations. Data missing/suppression symbols are preserved as strings or null, never silently coerced to zero. Empty responses mean no returned records, not zero measured people.

## Limits and credentials

Requests use fixed HTTPS endpoints with redirects refused and 15-second timeouts. Responses are bounded at 1 MB and 1,000 rows; oversized results fail instead of silently truncating. Search returns a page of up to 20 results. Successful queries are cached for 10 minutes in a bounded process-local cache; timestamps retain the original retrieval time. A process-local 20 outbound requests/minute cap is a best-effort guard, not a distributed quota guarantee. KOSIS provider limits across instances still apply. Provider exceptions and API errors are sanitized because request URLs contain the key. Do not log upstream URLs or submit private documents or personal information as search terms.

## Release and validation

Use a branch-scoped DEV/Preview KOSIS key for connected QA. Compare one search → metadata → values sequence to the public KOSIS table. No live credential has been provisioned by this change; mocked transport tests do not establish live API compatibility. Production key configuration and production deployment require the corresponding approval. Rollback is reverting the code commit and removing the environment variable; no migration is required.

## Primary references

- https://sso.kosis.kr/openapi/devGuide/devGuide_0701List.do
- https://sso.kosis.kr/openapi/devGuide/devGuide_060101List.do
- https://sso.kosis.kr/openapi/devGuide/devGuide_0201List.do
- https://sso.kosis.kr/openapi/community/community_0401List.do

KOSIS authentication keys require an application. Its FAQ permits commercial use generally but restricts licensed international/North Korean statistics to noncommercial use. Confirm terms for the selected dataset and current provider quota before release.
