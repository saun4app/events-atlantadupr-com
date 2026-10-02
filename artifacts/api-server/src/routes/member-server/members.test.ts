import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { eq, inArray } from "drizzle-orm";

import {
  assertTestDatabase,
  db,
  membersTable,
  pool,
  sessionsTable,
  userRoleIdMap,
  usersTable,
} from "@workspace/db";
import app from "../../app.js";

let server: Server;
let baseUrl: string;
let adminToken: string;
let adminId: number;
const fixtureDuprIds: string[] = [];

function uniqueId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

async function requestCsv(csv: string) {
  return fetch(`${baseUrl}/members/csv`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      authorization: `Bearer ${adminToken}`,
    },
    body: csv,
  });
}

before(async () => {
  await assertTestDatabase();

  const [admin] = await db
    .insert(usersTable)
    .values({
      name: "Member CSV Test Admin",
      username: uniqueId("member-csv-admin").toLowerCase(),
      passwordHash: "test-password-hash",
      role: userRoleIdMap.app_admin,
    })
    .returning();
  adminId = admin.id;
  adminToken = uniqueId("member-csv-token");
  await db.insert(sessionsTable).values({
    token: adminToken,
    data: { userId: adminId, role: userRoleIdMap.app_admin },
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  await assertTestDatabase();
  if (fixtureDuprIds.length > 0) {
    await db
      .delete(membersTable)
      .where(inArray(membersTable.duprId, fixtureDuprIds));
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.token, adminToken));
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("Manage Members CSV upsert", () => {
  it("updates only rating fields, inserts new rows, and preserves omitted rows", async () => {
    const existingId = uniqueId("MEMBER-EXISTING");
    const omittedId = uniqueId("MEMBER-OMITTED");
    const newId = uniqueId("MEMBER-NEW");
    fixtureDuprIds.push(existingId, omittedId, newId);

    await db.insert(membersTable).values([
      {
        duprId: existingId,
        name: "Existing member name",
        doubles: "3.100",
        doublesReliability: 10,
        singles: "2.100",
        singlesReliability: 20,
        selfRating: "2.500",
        email: "existing@example.test",
        phone: "111-111-1111",
      },
      {
        duprId: omittedId,
        name: "Member not in CSV",
        doubles: "3.000",
        doublesReliability: 11,
        singles: "2.000",
        singlesReliability: 21,
        selfRating: "2.400",
        email: "omitted@example.test",
        phone: "222-222-2222",
      },
    ]);

    const csv = [
      "dupr_id,name,doubles,doubles_reliability,singles,singles_reliability,self_rating,email,phone",
      `${existingId},Changed name,4.000,90,3.500,80,4.500,changed@example.test,999-999-9999`,
      `${newId},New member,3.800,70,3.200,60,3.600,new@example.test,333-333-3333`,
    ].join("\n");
    const response = await requestCsv(csv);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(result, {
      imported: 2,
      skipped: 0,
      removed: 0,
      regSkipped: [],
      errors: [],
    });

    const storedMembers = await db
      .select()
      .from(membersTable)
      .where(inArray(membersTable.duprId, fixtureDuprIds));
    const storedById = new Map(storedMembers.map((member) => [member.duprId, member]));
    assert.deepEqual(storedById.get(existingId), {
      duprId: existingId,
      name: "Existing member name",
      doubles: "4.000",
      doublesReliability: 90,
      singles: "3.500",
      singlesReliability: 80,
      selfRating: "2.500",
      email: "existing@example.test",
      phone: "111-111-1111",
    });
    assert.deepEqual(storedById.get(omittedId), {
      duprId: omittedId,
      name: "Member not in CSV",
      doubles: "3.000",
      doublesReliability: 11,
      singles: "2.000",
      singlesReliability: 21,
      selfRating: "2.400",
      email: "omitted@example.test",
      phone: "222-222-2222",
    });
    assert.deepEqual(storedById.get(newId), {
      duprId: newId,
      name: "New member",
      doubles: "3.800",
      doublesReliability: 70,
      singles: "3.200",
      singlesReliability: 60,
      selfRating: "3.600",
      email: "new@example.test",
      phone: "333-333-3333",
    });
  });

  it("parses quoted commas, escaped quotes, multiline fields, and ordinary rows", async () => {
    const commaId = uniqueId("MEMBER-COMMA");
    const quotedId = uniqueId("MEMBER-QUOTED");
    const multilineId = uniqueId("MEMBER-MULTILINE");
    const ordinaryId = uniqueId("MEMBER-ORDINARY");
    fixtureDuprIds.push(commaId, quotedId, multilineId, ordinaryId);

    const csv = [
      "dupr_id,name,doubles,doubles_reliability,singles,singles_reliability,self_rating,email,phone",
      `${commaId},"Doe, Jane",3.900,75,3.400,65,3.800,"jane,doe@example.test","(404) 555, 0101"`,
      `${quotedId},"The ""Ace"", Jane",3.700,70,3.200,60,3.600,"ace""quoted""@example.test","555 ""Ace"""`,
      `${multilineId},"Line one\r\nline two",3.600,65,3.100,55,3.500,multi@example.test,444-444-4444`,
      `${ordinaryId},Ordinary Member,3.500,60,3.000,50,3.400,ordinary@example.test,333-333-3333`,
    ].join("\r\n");

    const response = await requestCsv(csv);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(result, {
      imported: 4,
      skipped: 0,
      removed: 0,
      regSkipped: [],
      errors: [],
    });

    const storedMembers = await db
      .select()
      .from(membersTable)
      .where(inArray(membersTable.duprId, fixtureDuprIds));
    const storedById = new Map(storedMembers.map((member) => [member.duprId, member]));

    assert.equal(storedById.get(commaId)?.name, "Doe, Jane");
    assert.equal(storedById.get(commaId)?.email, "jane,doe@example.test");
    assert.equal(storedById.get(commaId)?.phone, "(404) 555, 0101");
    assert.equal(storedById.get(quotedId)?.name, 'The "Ace", Jane');
    assert.equal(storedById.get(quotedId)?.email, 'ace"quoted"@example.test');
    assert.equal(storedById.get(quotedId)?.phone, '555 "Ace"');
    assert.equal(storedById.get(multilineId)?.name, "Line one\r\nline two");
    assert.equal(storedById.get(ordinaryId)?.name, "Ordinary Member");
    assert.equal(storedById.get(ordinaryId)?.email, "ordinary@example.test");
  });

  it("imports whole-number reliability percentages from 0 to 100 and rejects invalid rows", async () => {
    const existingId = uniqueId("MEMBER-INVALID-RELIABILITY");
    const validId = uniqueId("MEMBER-RELIABILITY-BOUNDARIES");
    const invalidRows = [
      { id: uniqueId("MEMBER-RELIABILITY-PREFIX"), doubles: "70players", singles: "50", field: "doubles_reliability" },
      { id: uniqueId("MEMBER-RELIABILITY-DECIMAL"), doubles: "50", singles: "80.5", field: "singles_reliability" },
      { id: uniqueId("MEMBER-RELIABILITY-TOO-HIGH"), doubles: "101", singles: "50", field: "doubles_reliability" },
      { id: uniqueId("MEMBER-RELIABILITY-NEGATIVE"), doubles: "-1", singles: "50", field: "doubles_reliability" },
      { id: uniqueId("MEMBER-RELIABILITY-SINGLES-HIGH"), doubles: "50", singles: "101", field: "singles_reliability" },
    ];
    fixtureDuprIds.push(existingId, validId, ...invalidRows.map(({ id }) => id));

    await db.insert(membersTable).values({
      duprId: existingId,
      name: "Existing member",
      doubles: "3.000",
      doublesReliability: 45,
      singles: "2.500",
      singlesReliability: 55,
      selfRating: null,
      email: null,
      phone: null,
    });

    const csv = [
      "dupr_id,name,doubles,doubles_reliability,singles,singles_reliability",
      `${existingId},Changed name,4.000,70players,3.500,50`,
      ...invalidRows.map(({ id, doubles, singles }) => `${id},Invalid member,3.000,${doubles},2.500,${singles}`),
      `${validId},Boundary member,3.000,0,2.500,100`,
    ].join("\n");
    const response = await requestCsv(csv);
    const result = await response.json() as { imported: number; skipped: number; errors: string[] };

    assert.equal(response.status, 200);
    assert.equal(result.imported, 1);
    assert.equal(result.skipped, invalidRows.length + 1);
    assert.equal(result.errors.length, invalidRows.length + 1);
    assert.match(result.errors[0], /^Row 2: Invalid doubles_reliability/);
    invalidRows.forEach(({ field }, index) => {
      assert.match(result.errors[index + 1], new RegExp(`^Row ${index + 3}: Invalid ${field}`));
    });

    const storedMembers = await db
      .select()
      .from(membersTable)
      .where(inArray(membersTable.duprId, fixtureDuprIds));
    const storedById = new Map(storedMembers.map((member) => [member.duprId, member]));

    assert.equal(storedById.get(existingId)?.name, "Existing member");
    assert.equal(storedById.get(existingId)?.doubles, "3.000");
    assert.equal(storedById.get(existingId)?.doublesReliability, 45);
    assert.equal(storedById.get(existingId)?.singlesReliability, 55);
    assert.equal(storedById.get(validId)?.doublesReliability, 0);
    assert.equal(storedById.get(validId)?.singlesReliability, 100);
    for (const { id } of invalidRows) {
      assert.equal(storedById.has(id), false);
    }
  });
});