# Renderer Boundary

## Rule

The renderer is a thin interaction layer. It should not own action semantics,
provider freshness, safety policy, target resolution, or verification.

## Allowed Responsibilities

- display chat, artifacts, activity, status, diagnostics, and settings
- collect prompt text and direct UI commands
- render approvals, clarifications, and choice cards
- send user decisions back to the daemon
- present compact progress and recovery states

## Current Decomposition Target

The renderer has been partially decomposed, but these files remain high-change
coordination points:

- `src/renderer/WidgetRuntime.tsx`
- `src/renderer/WidgetRuntimeView.tsx`
- `src/renderer/hooks/useChatSessionController.ts`
- `src/renderer/components/BrowserActionMenu.tsx`

Preferred future slices:

- runtime connection
- session model
- message stream/typing
- interaction decisions
- capability status
- mode menu control
- diagnostics surfaces

Current extracted slices include derived runtime display state and composer
submission/focus/key handling. Browser Action clarification cards may render
redacted target previews, but target semantics, safety, and verification remain
daemon-owned.
