import assert from "node:assert/strict";
import test from "node:test";
import { clearAnswerDraft, getAnswerDraft, setAnswerDraft } from "../public/study-session.js";

test("answer drafts survive serialization and restore for the active question", () => {
  const session = { questionIds: ["mcq-1", "written-1"], drafts: {} };
  assert.equal(setAnswerDraft(session, "mcq-1", { selected: 2, response: "" }), true);
  assert.equal(setAnswerDraft(session, "written-1", { selected: null, response: "Review the medication list." }), true);

  const restored = JSON.parse(JSON.stringify(session));
  assert.deepEqual(getAnswerDraft(restored, "mcq-1"), { selected: 2, response: "" });
  assert.deepEqual(getAnswerDraft(restored, "written-1"), {
    selected: null,
    response: "Review the medication list."
  });
});

test("answer drafts are cleared when an answer is submitted", () => {
  const session = { drafts: { "q-1": { selected: 1, response: "" } } };

  clearAnswerDraft(session, "q-1");

  assert.equal(getAnswerDraft(session, "q-1"), null);
});

test("invalid draft values are normalized and invalid inputs are rejected", () => {
  const session = {};
  assert.equal(setAnswerDraft(session, "q-1", { selected: -1, response: 4 }), true);
  assert.deepEqual(getAnswerDraft(session, "q-1"), { selected: null, response: "" });
  assert.equal(setAnswerDraft(session, "", { selected: 0, response: "" }), false);
  assert.equal(setAnswerDraft(session, "q-2", null), false);
  assert.equal(getAnswerDraft(session, "q-2"), null);
});
