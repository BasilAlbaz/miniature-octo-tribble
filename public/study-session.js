export function getAnswerDraft(session, questionId) {
  if (!session || typeof questionId !== "string") return null;
  const draft = session.drafts?.[questionId];
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  return {
    selected: Number.isInteger(draft.selected) && draft.selected >= 0 ? draft.selected : null,
    response: typeof draft.response === "string" ? draft.response : ""
  };
}

export function setAnswerDraft(session, questionId, draft) {
  if (
    !session ||
    typeof questionId !== "string" ||
    !questionId ||
    !draft ||
    typeof draft !== "object" ||
    Array.isArray(draft)
  ) return false;
  if (!session.drafts || typeof session.drafts !== "object" || Array.isArray(session.drafts)) session.drafts = {};
  session.drafts[questionId] = {
    selected: Number.isInteger(draft.selected) && draft.selected >= 0 ? draft.selected : null,
    response: typeof draft.response === "string" ? draft.response : ""
  };
  return true;
}

export function clearAnswerDraft(session, questionId) {
  if (!session?.drafts || typeof questionId !== "string") return;
  delete session.drafts[questionId];
}
