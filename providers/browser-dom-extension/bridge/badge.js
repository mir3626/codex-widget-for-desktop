const BADGES = {
  OFF: { text: "OFF", color: "#64748b" },
  IDLE: { text: "IDLE", color: "#0f766e" },
  RUN: { text: "RUN", color: "#2563eb" },
  ASK: { text: "ASK", color: "#b45309" },
  ERR: { text: "ERR", color: "#b91c1c" }
};

export async function setBridgeBadge(state, tabId) {
  const badge = BADGES[state] ?? BADGES.ERR;
  const input = tabId ? { tabId, text: badge.text } : { text: badge.text };
  await chrome.action.setBadgeText(input);
  await chrome.action.setBadgeBackgroundColor(tabId ? { tabId, color: badge.color } : { color: badge.color });
}
