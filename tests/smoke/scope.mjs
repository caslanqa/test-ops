// Projeler/workspace'ler arası ID doğrulaması smoke testi (FR-003, design-doc bölüm 8).
// Çalışan bir stack'e karşı koşar ve kendi verisini oluşturur:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/scope.mjs
// BASE, ADMIN_EMAIL, ADMIN_PASSWORD env'leri ile hedef değiştirilebilir.
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

// --- Kurulum: admin -> WB/PB (kurban), attacker -> WA/PA (kendi alanı) ---
const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
const wb = await ok(admin, "POST", "/workspaces", { name: "Victim", slug: `victim-${sfx}` });
const pb = await ok(admin, "POST", `/workspaces/${wb.id}/projects`, { key: "VIC", name: "Victim" });
const attackerEmail = `attacker-${sfx}@test.local`;
const outsiderEmail = `outsider-${sfx}@test.local`;
await ok(admin, "POST", `/workspaces/${wb.id}/members`, { email: attackerEmail, displayName: "Attacker", password: "Password123!", role: "MEMBER" });
await ok(admin, "POST", `/workspaces/${wb.id}/members`, { email: outsiderEmail, displayName: "Outsider", password: "Password123!", role: "MEMBER" });

const P = `/projects/${pb.id}`;
const sb = await ok(admin, "POST", `${P}/suites`, { name: "Gizli suite" });
const cb = await ok(admin, "POST", `${P}/cases`, { title: "Gizli case", suiteId: sb.id, steps: [{ action: "gizli adım" }] });
const mb = await ok(admin, "POST", `${P}/milestones`, { name: "Gizli milestone" });
const plb = await ok(admin, "POST", `${P}/plans`, { title: "Gizli plan", testCaseIds: [cb.id], milestoneId: mb.id });
const rb = await ok(admin, "POST", `${P}/runs`, { title: "Gizli run", planId: plb.id });
const resB = await ok(admin, "POST", `${P}/runs/${rb.id}/results`, { testCaseId: cb.id, status: "FAILED" });
const reqB = await ok(admin, "POST", `${P}/requirements`, { title: "Gizli requirement" });
await ok(admin, "POST", `${P}/requirements/${reqB.id}/cases`, { testCaseIds: [cb.id] });
const db = await ok(admin, "POST", `${P}/defects`, { title: "Gizli defect", resultIds: [resB.id] });

const attacker = await login(attackerEmail, "Password123!");
const wa = await ok(attacker, "POST", "/workspaces", { name: "Mine", slug: `mine-${sfx}` });
const pa = await ok(attacker, "POST", `/workspaces/${wa.id}/projects`, { key: "MINE", name: "Mine" });
const A = `/projects/${pa.id}`;
const ca = await ok(attacker, "POST", `${A}/cases`, { title: "Benim case" });
const reqA = await ok(attacker, "POST", `${A}/requirements`, { title: "Benim requirement" });
const plA = await ok(attacker, "POST", `${A}/plans`, { title: "Benim plan" });
const dA = await ok(attacker, "POST", `${A}/defects`, { title: "Benim defect" });
const wbMembers = await ok(attacker, "GET", `/workspaces/${wb.id}/members`);
const attackerWbMember = wbMembers.find((m) => m.user.email === attackerEmail);
const adminWbMember = wbMembers.find((m) => m.user.email === ADMIN_EMAIL);
const pbMembers = await ok(admin, "GET", `${P}/members`);
const outsider = wbMembers.find((m) => m.user.email === outsiderEmail);

console.log("\n--- Başka projenin kayıtları reddedilmeli (404) ---");
await expect("requirement'a yabancı case bağlama", 404, attacker, "POST", `${A}/requirements/${reqA.id}/cases`, { testCaseIds: [cb.id] });
await expect("yabancı case ile plan oluşturma", 404, attacker, "POST", `${A}/plans`, { title: "x", testCaseIds: [cb.id] });
await expect("plana yabancı case ekleme", 404, attacker, "POST", `${A}/plans/${plA.id}/cases`, { testCaseIds: [cb.id] });
await expect("yabancı result ile defect oluşturma", 404, attacker, "POST", `${A}/defects`, { title: "x", resultIds: [resB.id] });
await expect("defect'e yabancı result bağlama", 404, attacker, "POST", `${A}/defects/${dA.id}/results`, { resultIds: [resB.id] });
await expect("yabancı requirement'tan case bağlantısı silme", 404, attacker, "DELETE", `${A}/requirements/${reqB.id}/cases/${cb.id}`);
await expect("yabancı plandan case silme", 404, attacker, "DELETE", `${A}/plans/${plb.id}/cases/${cb.id}`);
await expect("yabancı defect'ten result bağlantısı silme", 404, attacker, "DELETE", `${A}/defects/${db.id}/results/${resB.id}`);
await expect("yabancı parent suite", 404, attacker, "POST", `${A}/suites`, { name: "x", parentId: sb.id });
await expect("yabancı suite'e case", 404, attacker, "POST", `${A}/cases`, { title: "x", suiteId: sb.id });
await expect("case'i yabancı suite'e taşıma", 404, attacker, "PATCH", `${A}/cases/${ca.id}`, { suiteId: sb.id });
await expect("yabancı milestone ile plan", 404, attacker, "POST", `${A}/plans`, { title: "x", milestoneId: mb.id });
await expect("yabancı milestone ile run", 404, attacker, "POST", `${A}/runs`, { title: "x", milestoneId: mb.id });
await expect("yabancı case ile ad hoc run", 404, attacker, "POST", `${A}/runs`, { title: "x", testCaseIds: [cb.id] });
await expect("projede olmayan kullanıcıya defect atama", 404, attacker, "POST", `${A}/defects`, { title: "x", assigneeId: outsider.user.id });

console.log("\n--- Workspace/project üyelik kapsamı (yetki yükseltme) ---");
await expect("kendi WB üyeliğini WA üzerinden ADMIN yapma", 404, attacker, "PATCH", `/workspaces/${wa.id}/members/${attackerWbMember.id}`, { role: "ADMIN" });
await expect("WB admin üyeliğini WA üzerinden silme", 404, attacker, "DELETE", `/workspaces/${wa.id}/members/${adminWbMember.id}`);
await expect("PB üyesinin rolünü PA üzerinden değiştirme", 404, attacker, "PATCH", `${A}/members/${pbMembers[0].id}`, { role: "VIEWER" });
await expect("PB üyesini PA üzerinden silme", 404, attacker, "DELETE", `${A}/members/${pbMembers[0].id}`);
const wbAfter = await ok(admin, "GET", `/workspaces/${wb.id}/members`);
const stillMember = wbAfter.find((m) => m.id === attackerWbMember.id);
const roleOk = stillMember?.role === "MEMBER" && wbAfter.some((m) => m.id === adminWbMember.id);
if (!roleOk) failures++;
console.log(`${roleOk ? "PASS" : "FAIL"} WB üyelikleri değişmedi`);

console.log("\n--- Suite hiyerarşi döngüsü (400) ---");
const s1 = await ok(attacker, "POST", `${A}/suites`, { name: "s1" });
const s2 = await ok(attacker, "POST", `${A}/suites`, { name: "s2", parentId: s1.id });
await expect("suite'i kendi altına taşıma", 400, attacker, "PATCH", `${A}/suites/${s1.id}`, { parentId: s1.id });
await expect("suite'i alt suite'inin altına taşıma", 400, attacker, "PATCH", `${A}/suites/${s1.id}`, { parentId: s2.id });

console.log("\n--- Aynı proje içi akışlar çalışmaya devam etmeli ---");
await expect("requirement'a kendi case'ini bağlama", 201, attacker, "POST", `${A}/requirements/${reqA.id}/cases`, { testCaseIds: [ca.id] });
await expect("bağlantıyı silme", 200, attacker, "DELETE", `${A}/requirements/${reqA.id}/cases/${ca.id}`);
await expect("olmayan bağlantıyı silme (eskiden 500)", 404, attacker, "DELETE", `${A}/requirements/${reqA.id}/cases/${ca.id}`);
await expect("plana kendi case'ini ekleme", 201, attacker, "POST", `${A}/plans/${plA.id}/cases`, { testCaseIds: [ca.id] });
await expect("plandan case silme", 200, attacker, "DELETE", `${A}/plans/${plA.id}/cases/${ca.id}`);
const runA = await ok(attacker, "POST", `${A}/runs`, { title: "r", testCaseIds: [ca.id] });
const resA = await ok(attacker, "POST", `${A}/runs/${runA.id}/results`, { testCaseId: ca.id, status: "FAILED" });
const me = await ok(attacker, "GET", "/auth/me");
await expect("kendi result'ı ile defect + kendine atama", 201, attacker, "POST", `${A}/defects`, { title: "d", resultIds: [resA.id], assigneeId: me.id });
await expect("defect'e kendi result'ını bağlama", 201, attacker, "POST", `${A}/defects/${dA.id}/results`, { resultIds: [resA.id] });
await expect("defect'ten result bağlantısı silme", 200, attacker, "DELETE", `${A}/defects/${dA.id}/results/${resA.id}`);
await expect("case'i kendi suite'ine taşıma", 200, attacker, "PATCH", `${A}/cases/${ca.id}`, { suiteId: s2.id });
await expect("suite'i geçerli parent'a taşıma", 200, attacker, "PATCH", `${A}/suites/${s2.id}`, { parentId: null });
const pbM = await ok(admin, "POST", `${P}/members`, { email: outsiderEmail, role: "VIEWER" });
await expect("kendi projesinde üye rolü güncelleme", 200, admin, "PATCH", `${P}/members/${pbM.id}`, { role: "TESTER" });
await expect("kendi workspace'inde üye rolü güncelleme", 200, admin, "PATCH", `/workspaces/${wb.id}/members/${outsider.id}`, { role: "ADMIN" });

console.log(`\n${failures === 0 ? "TÜMÜ GEÇTİ" : `${failures} BAŞARISIZ`}`);
process.exit(failures === 0 ? 0 : 1);
