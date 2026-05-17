## Iteration iter-7: Dogfood UI Motion Polish

Carryover: The renderer is now structurally split, so follow-up UI polish should stay within those feature components and partial CSS files instead of growing `App.tsx` again.

### iter-7-sprint-01-trash-activity-mascot-polish

Goal: apply three dogfood UI corrections: trash artifact icon placement, compact Activity footer height, and real frame-based mascot motion.

Dependencies: `SessionStrip`, Activity footer CSS, current mascot PNG asset, renderer smoke coverage.

Expected scope: move the artifact icon beside the artifact count in the trash list, reduce the Activity footer's reserved height after the one-line log change, replace CSS bounce/share mascot motion with a sprite/APNG/Lottie-like frame animation derived from the existing mascot asset, and add smoke assertions where practical.

Status: partially accepted after dogfood review. Trash artifact rows now render the session title first and an artifact-count cluster with the file icon directly left of the count. The Activity footer grid row and log-list minimum height were reduced from 76px to 52px. The mascot sprite implementation is rejected as a proxy implementation: it was generated from one static pose and does not meet the product intent of a genuinely moving mascot. Treat mascot motion as a rework item that requires a consensus step and real authored motion frames/assets before implementation. The previous renderer smoke only proves the sprite path exists; it is not acceptance evidence for mascot motion quality.
