# Browser View Graph v2 Dogfood Evidence

Date: 2026-05-10
Scenario: deterministic generic board filter plus representative content flow

## Summary

- Before route key: `7d9299dcb4d321de2560`
- After route key: `c4e53f04de8243d7572c`
- Before graph: 12 nodes, 18 edges
- After graph: 12 nodes, 18 edges
- Content lists after filter: 1
- Redaction policy: metadata_only

## Action Transcript

1. Resolve `개념글` against a generic board-like view with both a primary filter button and a sidebar link.
   - Selected: `concept-filter` / 개념글
   - Confidence: 0.906
   - Reason: Semantic Interface selected button 개념글 for activate.
2. Reobserve a query-transitioned view with a refreshed content list.
3. Resolve `재밌어보이는 글` against View Graph v2 representative content-list evidence.
   - Selected: `post-fun-1` / 흥미로운 기술 글 제목
   - Confidence: 0.97
   - Reason: Selected representative content item link 흥미로운 기술 글 제목 from Browser View Graph v2 content-list evidence.

## Semantic Projection

- Semantic entities: 12
- Semantic relations: 17
- Concept entity tier2: `{"browserElementId":"concept-filter","viewNodeId":"view-concept-filter","regionRole":"toolbar","viewActionHint":"filter","viewRiskHints":"same_page_update","viewListId":"","viewFormId":"","viewFreshness":"fresh","role":"button","tagName":"button","redacted":"false","viewRevision":"0a4a4eebd1af72eaf229"}`
- Content entity tier2: `{"browserElementId":"post-fun-1","viewNodeId":"view-post-fun-1","regionRole":"list","viewActionHint":"navigate","viewRiskHints":"navigation","viewListId":"list-6610c2b0846b","viewFormId":"","viewFreshness":"fresh","role":"link","tagName":"a","redacted":"false","viewRevision":"0a4a4eebd1af72eaf229"}`

## Supporting Asset

- `docs/reports/assets/browser-view-graph-v2-2026-05-10/evidence.json`
