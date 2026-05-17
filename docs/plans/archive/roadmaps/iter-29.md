## Iteration iter-29: Computer Use UIA Semantic Tree

Status: complete.

Carryover: UIA semantic refs were a feasible implementation-ready parity item
after iter-28, but they had to start as read-only observe with no native input.

### iter-29-sprint-01-uia-semantic-tree-observe-api

Goal: add refs-map semantic tree support for windows, buttons, textboxes,
menus, lists, and stable find-elements queries.

Status: complete. Added shared semantic tree protocol types, UIA/native-helper
snapshot normalization, `/computer-use/snapshot`,
`/computer-use/find-elements`, session-scoped snapshot/find-elements routes,
operation handling, redacted debug-bundle evidence, and
`smoke:computer-use-uia-semantic-tree`.
