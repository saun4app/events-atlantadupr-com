import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseCsvRecords } from "./csv.js";

describe("member CSV parsing", () => {
  it("parses quoted commas, escaped quotes, and ordinary fields", () => {
    assert.deepEqual(
      parseCsvRecords(
        'dupr_id,name,email,phone\r\n' +
          '1,"Doe, Jane","jane,doe@example.test","(404) 555, 0101"\r\n' +
          '2,"The ""Ace"", Jane","ace""quoted""@example.test","555 ""Ace"""\r\n' +
          "3,Ordinary Member,ordinary@example.test,333-333-3333",
      ),
      [
        ["dupr_id", "name", "email", "phone"],
        ["1", "Doe, Jane", "jane,doe@example.test", "(404) 555, 0101"],
        ["2", 'The "Ace", Jane', 'ace"quoted"@example.test', '555 "Ace"'],
        ["3", "Ordinary Member", "ordinary@example.test", "333-333-3333"],
      ],
    );
  });

  it("keeps line breaks inside quoted fields", () => {
    assert.deepEqual(parseCsvRecords('1,"Line one\r\nline two",value'), [
      ["1", "Line one\r\nline two", "value"],
    ]);
  });

  it("rejects malformed quoting", () => {
    assert.throws(() => parseCsvRecords('1,"unterminated'), /unterminated quoted field/);
    assert.throws(() => parseCsvRecords('1,un"escaped'), /Unexpected quote in unquoted field/);
    assert.throws(() => parseCsvRecords('1,"closed" extra'), /Unexpected character after closing quote/);
  });
});