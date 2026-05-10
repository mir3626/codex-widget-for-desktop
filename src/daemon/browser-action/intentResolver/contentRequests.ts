export function isClickThenContentRequest(text: string, firstTarget: string | undefined): boolean {
  return Boolean(firstTarget) &&
    /눌러서|누르고|누른\s*(?:뒤|후|다음)|클릭해서|클릭하고|press(?:ing)?\s+(?:and|then)|click(?:ing)?\s+(?:and|then)|\bthen\b/i.test(text) &&
    isContentOpenRequest(text);
}

export function isContentOpenRequest(text: string): boolean {
  if (isDirectFilterOrNavigationClick(text)) {
    return false;
  }
  return /(글|게시글|포스트|게시물|article|post|item).*(보여|열어|읽어|골라|선택|눌러|누르|클릭|show|open|read|pick|choose|click|press)|(?:재밌|재미|흥미|interesting|fun).*(보여|열어|읽어|눌러|누르|클릭|show|open|read|click|press)|(?:아무거나|아무\s*글|any\s+(?:post|article|item))/i.test(text);
}

export function readContentRequestTarget(text: string): string {
  if (/(재밌|재미|흥미|interesting|fun)/i.test(text)) {
    return "재밌어보이는 글";
  }
  if (/(아무거나|아무\s*글|any\s+(?:post|article|item))/i.test(text)) {
    return "아무 글";
  }
  return "대표 글";
}

function isDirectFilterOrNavigationClick(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ");
  return /^(개념글|전체글|공지|인기글|베스트|포텐|포텐터짐|best|hot|popular|recommend)(?:\s*(?:버튼|탭|메뉴|링크))?\s*(?:눌러|눌러줘|누르|클릭|클릭해|클릭해줘|열어|열어줘|보여줘?)$/i.test(normalized);
}
