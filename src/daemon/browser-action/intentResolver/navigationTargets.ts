import { normalizeBrowserTargetText } from "../targetLexicon.js";

export const DCINSIDE_THESINGULARITY_URL = "https://gall.dcinside.com/mgallery/board/lists/?id=thesingularity";

export function isBookmarkNavigationRequest(text: string): boolean {
  return /즐겨찾기|북마크|bookmark|favorite/i.test(text) && /열어|이동|접속|켜|open|go\s*to|navigate/i.test(text);
}

export function extractBookmarkNavigationTargetPhrase(text: string): string | undefined {
  const normalized = normalizeBrowserTargetText(text)
    .replace(/(?:즐겨찾기|북마크|bookmark|favorite)(?:에|에서|의|로|으로)?/gi, " ")
    .replace(/(?:로|으로)?\s*(?:이동|접속|열어|켜|가)(?:줘|주세요|달라|해줘|해)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export function resolveKnownBrowserDestinationUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeBrowserDestinationAlias(value);
  const aliases: Array<[RegExp, string]> = [
    [/^(google|구글)$/, "https://www.google.com/"],
    [/^(naver|네이버)$/, "https://www.naver.com/"],
    [/^(youtube|유튜브|유튭)$/, "https://www.youtube.com/"],
    [/^(github|깃허브|기트허브)$/, "https://github.com/"],
    [/^(dcinside|디시|디시인사이드)$/, "https://www.dcinside.com/"],
    [/^(fmkorea|펨코|에펨코리아)$/, "https://www.fmkorea.com/"],
    [/^(chzzk|치지직)$/, "https://chzzk.naver.com/"],
    [/^(특갤|특이점이온다|특이점이온다갤러리|특이점이온다마이너갤러리|thesingularity|thesingularitygallery)$/, DCINSIDE_THESINGULARITY_URL]
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1];
}

export function resolveBookmarkOpenTarget(text: string): { phrase: string; url: string } | undefined {
  if (!isBookmarkNavigationRequest(text)) {
    return undefined;
  }
  const phrase = extractBookmarkNavigationTargetPhrase(text) ?? text;
  const url = resolveKnownBrowserDestinationUrl(phrase);
  return url ? { phrase, url } : undefined;
}

function normalizeBrowserDestinationAlias(value: string): string {
  return normalizeBrowserTargetText(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?。！？]+$/g, "")
    .replace(/(?:즐겨찾기|북마크|bookmark|favorite)(?:에|에서|의|로|으로)?/gi, "");
}
