// Smoke test for cross-project/cross-workspace ID validation (FR-003, design-doc section 8).
// Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/scope.mjs
// The target can be changed with the BASE, ADMIN_EMAIL and ADMIN_PASSWORD env vars.
const BASE = process.env.BASE ?? "http://localhost:8080/api/v1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@testops.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
async function ok(token, method, path, body) {
  const r = await call(token, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}
async function expect(label, expected, token, method, path, body) {
  const r = await call(token, method, path, body);
  const pass = r.status === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} [${r.status}${pass ? "" : ` != ${expected}`}] ${label}${pass ? "" : " " + JSON.stringify(r.json)}`);
}
const login = async (email, password) =>
  (await ok(null, "POST", "/auth/login", { email, password })).accessToken;

// --- Setup: admin -> WB/PB (victim), attacker -> WA/PA (own space) ---
const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
const wb = await ok(admin, "POST", "/workspaces", { name: "Victim", slug: `victim-${sfx}` });
const pb = await ok(admin, "POST", `/workspaces/${wb.id}/projects`, { key: "VIC", name: "Victim" });
const attackerEmail = `attacker-${sfx}@test.local`;
// The attacker creates their account with an invitation link and joins WB as a plain member.
const invitation = await ok(admin, "POST", `/workspaces/${wb.id}/invitations`, { email: attackerEmail, role: "MEMBER" });
const attacker = (await ok(null, "POST", "/auth/register", { email: attackerEmail, displayName: "Attacker", password: "Password123!", inviteToken: invitation.token })).accessToken;

const P = `/projects/${pb.id}`;
const sb = await ok(admin, "POST", `${P}/suites`, { name: "Secret suite" });
const cb = await ok(admin, "POST", `${P}/cases`, { title: "Secret case", suiteId: sb.id, steps: [{ action: "secret step" }] });
const mb = await ok(admin, "POST", `${P}/milestones`, { name: "Secret milestone" });
const plb = await ok(admin, "POST", `${P}/plans`, { title: "Secret plan", testCaseIds: [cb.id], milestoneId: mb.id });
const rb = await ok(admin, "POST", `${P}/runs`, { title: "Secret run", planId: plb.id });
const resB = await ok(admin, "POST", `${P}/runs/${rb.id}/results`, { testCaseId: cb.id, status: "FAILED" });
const reqB = await ok(admin, "POST", `${P}/requirements`, { title: "Secret requirement" });
await ok(admin, "POST", `${P}/requirements/${reqB.id}/cases`, { testCaseIds: [cb.id] });
const db = await ok(admin, "POST", `${P}/defects`, { title: "Secret defect", resultIds: [resB.id] });

const wa = await ok(attacker, "POST", "/workspaces", { name: "Mine", slug: `mine-${sfx}` });
const pa = await ok(attacker, "POST", `/workspaces/${wa.id}/projects`, { key: "MINE", name: "Mine" });
const A = `/projects/${pa.id}`;
const ca = await ok(attacker, "POST", `${A}/cases`, { title: "My case" });
const reqA = await ok(attacker, "POST", `${A}/requirements`, { title: "My requirement" });
const plA = await ok(attacker, "POST", `${A}/plans`, { title: "My plan" });
const dA = await ok(attacker, "POST", `${A}/defects`, { title: "My defect" });
const wbMembers = await ok(attacker, "GET", `/workspaces/${wb.id}/members`);
const attackerWbMember = wbMembers.find((m) => m.user.email === attackerEmail);
const adminWbMember = wbMembers.find((m) => m.user.email === ADMIN_EMAIL);
const pbMembers = await ok(admin, "GET", `${P}/members`);

console.log("\n--- Records of another project must be rejected (404) ---");
await expect("link a foreign case to a requirement", 404, attacker, "POST", `${A}/requirements/${reqA.id}/cases`, { testCaseIds: [cb.id] });
await expect("create a plan with a foreign case", 404, attacker, "POST", `${A}/plans`, { title: "x", testCaseIds: [cb.id] });
await expect("add a foreign case to a plan", 404, attacker, "POST", `${A}/plans/${plA.id}/cases`, { testCaseIds: [cb.id] });
await expect("create a defect with a foreign result", 404, attacker, "POST", `${A}/defects`, { title: "x", resultIds: [resB.id] });
await expect("link a foreign result to a defect", 404, attacker, "POST", `${A}/defects/${dA.id}/results`, { resultIds: [resB.id] });
await expect("remove a case link from a foreign requirement", 404, attacker, "DELETE", `${A}/requirements/${reqB.id}/cases/${cb.id}`);
await expect("remove a case from a foreign plan", 404, attacker, "DELETE", `${A}/plans/${plb.id}/cases/${cb.id}`);
await expect("remove a result link from a foreign defect", 404, attacker, "DELETE", `${A}/defects/${db.id}/results/${resB.id}`);
await expect("foreign parent suite", 404, attacker, "POST", `${A}/suites`, { name: "x", parentId: sb.id });
await expect("case in a foreign suite", 404, attacker, "POST", `${A}/cases`, { title: "x", suiteId: sb.id });
await expect("move a case into a foreign suite", 404, attacker, "PATCH", `${A}/cases/${ca.id}`, { suiteId: sb.id });
await expect("plan with a foreign milestone", 404, attacker, "POST", `${A}/plans`, { title: "x", milestoneId: mb.id });
await expect("run with a foreign milestone", 404, attacker, "POST", `${A}/runs`, { title: "x", milestoneId: mb.id });
await expect("ad hoc run with a foreign case", 404, attacker, "POST", `${A}/runs`, { title: "x", testCaseIds: [cb.id] });
await expect("assign a defect to a user outside the project", 404, attacker, "POST", `${A}/defects`, { title: "x", assigneeId: adminWbMember.user.id });

console.log("\n--- Workspace/project membership scope (privilege escalation) ---");
await expect("make own WB membership ADMIN via WA", 404, attacker, "PATCH", `/workspaces/${wa.id}/members/${attackerWbMember.id}`, { role: "ADMIN" });
await expect("delete the WB admin membership via WA", 404, attacker, "DELETE", `/workspaces/${wa.id}/members/${adminWbMember.id}`);
await expect("change a PB member's role via PA", 404, attacker, "PATCH", `${A}/members/${pbMembers[0].id}`, { role: "VIEWER" });
await expect("delete a PB member via PA", 404, attacker, "DELETE", `${A}/members/${pbMembers[0].id}`);
const wbAfter = await ok(admin, "GET", `/workspaces/${wb.id}/members`);
const stillMember = wbAfter.find((m) => m.id === attackerWbMember.id);
const roleOk = stillMember?.role === "MEMBER" && wbAfter.some((m) => m.id === adminWbMember.id);
if (!roleOk) failures++;
console.log(`${roleOk ? "PASS" : "FAIL"} WB memberships unchanged`);

console.log("\n--- Suite hierarchy cycle (400) ---");
const s1 = await ok(attacker, "POST", `${A}/suites`, { name: "s1" });
const s2 = await ok(attacker, "POST", `${A}/suites`, { name: "s2", parentId: s1.id });
await expect("move a suite under itself", 400, attacker, "PATCH", `${A}/suites/${s1.id}`, { parentId: s1.id });
await expect("move a suite under its own child suite", 400, attacker, "PATCH", `${A}/suites/${s1.id}`, { parentId: s2.id });

console.log("\n--- Flows within the same project must keep working ---");
await expect("link own case to a requirement", 201, attacker, "POST", `${A}/requirements/${reqA.id}/cases`, { testCaseIds: [ca.id] });
await expect("remove the link", 200, attacker, "DELETE", `${A}/requirements/${reqA.id}/cases/${ca.id}`);
await expect("remove a non-existent link (used to return 500)", 404, attacker, "DELETE", `${A}/requirements/${reqA.id}/cases/${ca.id}`);
await expect("add own case to a plan", 201, attacker, "POST", `${A}/plans/${plA.id}/cases`, { testCaseIds: [ca.id] });
await expect("remove a case from a plan", 200, attacker, "DELETE", `${A}/plans/${plA.id}/cases/${ca.id}`);
const runA = await ok(attacker, "POST", `${A}/runs`, { title: "r", testCaseIds: [ca.id] });
const resA = await ok(attacker, "POST", `${A}/runs/${runA.id}/results`, { testCaseId: ca.id, status: "FAILED" });
const me = await ok(attacker, "GET", "/auth/me");
await expect("defect with own result + assign to self", 201, attacker, "POST", `${A}/defects`, { title: "d", resultIds: [resA.id], assigneeId: me.id });
await expect("link own result to a defect", 201, attacker, "POST", `${A}/defects/${dA.id}/results`, { resultIds: [resA.id] });
await expect("remove a result link from a defect", 200, attacker, "DELETE", `${A}/defects/${dA.id}/results/${resA.id}`);
await expect("move a case into own suite", 200, attacker, "PATCH", `${A}/cases/${ca.id}`, { suiteId: s2.id });
await expect("move a suite to a valid parent", 200, attacker, "PATCH", `${A}/suites/${s2.id}`, { parentId: null });
// The admin manages roles in their own project and workspace; here the attacker is just a member.
const pbM = await ok(admin, "POST", `${P}/members`, { email: attackerEmail, role: "VIEWER" });
await expect("update a member role in own project", 200, admin, "PATCH", `${P}/members/${pbM.id}`, { role: "TESTER" });
await expect("update a member role in own workspace", 200, admin, "PATCH", `/workspaces/${wb.id}/members/${attackerWbMember.id}`, { role: "ADMIN" });

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
