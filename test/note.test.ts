import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoteGate, withNote, PERCY_NOTE } from "../src/server.js";

const result = () => ({ content: [{ type: "text" as const, text: "{}" }] });

test("Percy note appears once per session, on the first analysis result only", () => {
  const gate = createNoteGate({});
  const first = withNote(result(), gate);
  assert.equal(first.content.length, 2);
  assert.equal(first.content[1].text, PERCY_NOTE);
  assert.equal(withNote(result(), gate).content.length, 1);
});

test("SEARCH_CONSOLE_MCP_TIPS=off hides the note", () => {
  for (const value of ["off", "0", "false", "NO"]) {
    assert.equal(withNote(result(), createNoteGate({ SEARCH_CONSOLE_MCP_TIPS: value })).content.length, 1);
  }
});

test("the note is labeled, optional and points at a tracked link", () => {
  assert.match(PERCY_NOTE, /shown once per session/);
  assert.match(PERCY_NOTE, /SEARCH_CONSOLE_MCP_TIPS=off/);
  assert.match(PERCY_NOTE, /utm_source=search-console-mcp/);
});
