# TestOps — Geliştirme Planı (Faz 1 sonrası)

**Durum:** Faz 1 çekirdek uçtan uca çalışıyor ve doğrulandı (bkz. repo memory / önceki konuşma özeti). Bu doküman, design-doc.md'deki fazlara göre **kalan işleri** ve kod incelemesinden çıkan **bilinen eksikleri** tek yerde toplar.

## 0. Öncelikli teknik borç (fazlardan bağımsız, önce ele alınmalı)

- [ ] **Audit log hiç yazılmıyor.** `AuditLog` Prisma modeli var ama hiçbir serviste insert çağrısı yok. Design-doc bölüm 8: "Kritik kullanıcı işlemleri audit log'a yazılmalı" — şu an karşılanmıyor. Öneri: `AccessControlService` veya ayrı bir `AuditService` ile write/delete/role-değişikliği gibi kritik aksiyonlarda kayıt at.
- [ ] **Rate limiting gerçekte uygulanmıyor.** FR-077 header formatını belgeliyoruz ama `@nestjs/throttler` gibi bir guard yok; istemci istediği kadar istek atabilir.
- [ ] **Otomatik test yok.** Ne API (Jest/e2e) ne web (component/e2e) tarafında test var. En azından auth + access-control + run/result akışı için smoke-level e2e testler eklenmeli.
- [ ] **Backup/restore prosedürü yazılı değil.** Design-doc bölüm 8 ve MVP kabul kriteri 7: PostgreSQL + attachment volume yedekleme/geri yükleme adımları dokümante edilmemiş.
- [ ] **FR-017 (otomasyon sonucu auto-case-creation) backend'de henüz yok.** Şu an `results.service.ts` sadece var olan `testCaseId` ile eşleşmezse 404 atıyor; isim/suite bazlı fallback eşleştirme veya otomatik case oluşturma yok.

### 0.1 Kod incelemesi bulguları (2 Ekim 2026)

**Güvenlik**

- [x] **Projeler/workspace'ler arası ID doğrulaması yok (FR-003, bölüm 8).** _(2 Ekim 2026: `AccessControlService` kapsam doğrulamaları eklendi; aşağıdaki tüm noktalar düzeltildi ve çalışan stack'e karşı 34 senaryoluk smoke testle doğrulandı.)_ İstek gövdesindeki yabancı anahtarlar URL'deki projeye ait mi kontrol edilmiyor:
  - `defects.service.ts` create/linkResults `resultIds`: başka projenin result'ı bağlanıp `getOne` ile `caseSnapshot` dahil okunabiliyor.
  - `requirements.service.ts` linkCases, `plans.service.ts` create/addCases `testCaseIds`: başka projenin case'i bağlanıp tam içeriği okunabiliyor.
  - `unlinkCase` / `removeCase` / `unlinkResult`: ebeveyn kaydın projeye aitliği kontrol edilmiyor → başka projedeki bağlantılar silinebiliyor.
  - `suiteId`, `parentId`, `milestoneId`, `assigneeId` doğrulanmıyor; suite `parentId` döngü (kendi alt suite'ine taşıma) kontrolü yok.
  - `workspaces.service.ts` / `projects.service.ts` `updateMemberRole` / `removeMember`: `memberId` URL'deki workspace/project'e ait mi kontrol edilmiyor → kendi workspace'inde admin olan herkes başka workspace'teki üyeliğini ADMIN yapabilir veya üye silebilir (**yetki yükseltme**).
- [x] **Varsayılan JWT secret.** _(2 Ekim 2026: `config/jwt-secret.ts` production'da boş/örnek/32 karakterden kısa secret ile bootstrap'i durduruyor; compose `${JWT_SECRET:?}` ile boş değeri reddediyor; `scripts/ensure-env.sh` rastgele secret üretiyor; `start.sh` uygulama hazır olmazsa logları gösterip hata ile çıkıyor ve `.env`'de `APP_PORT` yokken sessizce çıkma hatası giderildi.)_ `configuration.ts` ve `docker-compose.yml` `change-me-in-production` kullanıyor; `start.sh` `.env.example`'ı kopyaladığı için varsayılan kurulumda JWT sahte üretilebilir. Production'da varsayılan/boş secret ile başlamayı reddetmeli.
- [x] **Postgres host'a açık.** _(2 Ekim 2026: port yalnızca `127.0.0.1`'e bağlanıyor; host'tan `prisma migrate dev` çalışmaya devam ediyor. Varsayılan DB parolası hâlâ `.env`'den geliyor — mevcut volume ile uyumsuzluk riski nedeniyle otomatik üretilmiyor.)_ `docker-compose.yml` varsayılan parola ile 5432'yi dışa açıyor; varsayılan olarak kapalı olmalı (gerekirse override dosyası).
- [x] **Attachment güvenliği.** _(2 Ekim 2026: uzantı allowlist'i (`ATTACHMENT_ALLOWED_EXTENSIONS`, varsayılanda svg yok) ve sunucuda uzantıdan türetilen Content-Type; `res.attachment` ile RFC 6266 `filename*`; multer disk storage (volume içi `.tmp` + atomik rename, akış ile checksum, reddedilende temizlik); `Content-Length` ile gövde okunmadan 413; ATTACHMENT_* limitleri compose'dan yapılandırılabilir ve geçersiz değerde uygulama başlamıyor. Ek olarak: Türkçe dosya adlarının DB'ye bozuk (`gÃ¶rÃ¼ntÃ¼`) kaydedilmesi düzeltildi, doğrudan `multer` bağımlılığı CVE'li 1.4.5-lts'ten yükseltildi (sonradan 2.4.0; bkz. Bağımlılık güvenlik açıkları). 18 senaryolu smoke test geçti. İçerik/magic-byte doğrulaması yok.)_
  - Bölüm 8'deki MIME/uzantı kontrolü yok (sadece boyut).
  - `attachments.controller.ts` dosya adını `Content-Disposition`'a ham yazıyor; Latin-1 dışı karakterli adlar (ş, ğ, ı) indirmede 500 verir, `"` header'ı bozar → RFC 5987 `filename*=UTF-8''…`.
  - `memoryStorage`: toplam 128 MB kontrolü dosyalar RAM'e alındıktan sonra yapılıyor (tek istek ~640 MB) → disk tabanlı storage veya stream.
- [ ] **Küçükler.** Token iptal yanıtı `tokenHash` döndürüyor; container root olarak çalışıyor.
- [x] **Bağımlılık güvenlik açıkları.** _(2 Ekim 2026: doğrudan `multer` 2.4.0'a yükseltildi; `@nestjs/platform-express` 10.x multer'ı tam 2.0.2'ye sabitlediği ve yüklemeleri o kopya işlediği için `pnpm-workspace.yaml` `overrides` ile tüm ağaçta 2.4.0 zorlanıyor. Aynı major içindeki lodash, js-yaml, qs ve body-parser yamaları da override ile alındı. `pnpm audit --prod` 20+ uyarıdan 4'e indi; kalanlar aşağıdaki Nest 11 maddesinde.)_
- [ ] **Nest 11 geçişi (kalan audit uyarıları).** `pnpm audit --prod` hâlâ şunları gösteriyor; hepsi major sürüm gerektirdiği için override ile zorlanmadı:
  - `@nestjs/core` GHSA-36xv-jgw5-4q75 (moderate) → yalnızca 11.1.18+.
  - `path-to-regexp` 0.2.5 (`@nestjs/serve-static` üzerinden) GHSA-9wv6-86v2-598j (high) → ≥1.9.0; serve-static 5.x ile gelir.
  - `file-type` 20.4.1 (`@nestjs/common` üzerinden) GHSA-5v7r-6r5c-r473, GHSA-j47w-4g3g-c36v (moderate) → ≥21.3.2. Kodda `FileTypeValidator`/`ParseFilePipe` kullanılmadığı için şu an erişilebilir değil.
  - Node 22 geçişiyle (aşağıda) birlikte yapılması önerilir; Express 5 rota sözdizimi ve `ServeStaticModule` exclude kalıpları gözden geçirilmeli.

**Doğruluk / fonksiyonel**

- [ ] **FR-072 yok.** Hiçbir listeleme endpoint'inde sayfalama/sıralama yok.
- [ ] **Coverage hatası.** `requirements.service.ts` `take: 200` tüm bağlı case'lerin sonuçlarını birlikte kesiyor; çok çalıştırılan case'lerde diğer case'lerin son durumu kayboluyor. Ayrıca requirement başına N+1 sorgu.
- [ ] **Bulk submit atomik değil.** `results.service.ts` `bulkSubmit` sıralı ve transaction'sız; tek hatalı öğede 404 döner ama önceki sonuçlar yazılmış kalır, istemci hangilerinin kaydedildiğini bilemez.
- [ ] **Idempotency yarışı.** `externalTestId` kontrolü transaction dışında; eşzamanlı CI job'ları çift kayıt üretebilir. Eski bir attempt'in `externalTestId`'si gelirse `RunCase.status` eski sonuca çekiliyor.
- [x] **Silme/bağlantı kaldırma 500 dönüyor.** Prisma `delete` kayıt yoksa P2025 fırlatıyor, global exception filter yok → 404 yerine 500. _(Bağlantı silmeler `deleteMany` + 404'e çevrildi, diğer silmeler önce varlık kontrolü yapıyor. Genel bir Prisma exception filter hâlâ yok.)_

**Araç zinciri**

- [ ] **API lint kırık.** `pnpm lint` → `eslint: command not found`; eslint ne kurulu ne yapılandırılmış.
- [x] **CI kapısı yok.** Tek workflow tag'de Docker publish; PR/push'ta build + typecheck + test yok. _(2 Ekim 2026: `ci.yml` — PR ve master push'unda build, typecheck, web lint ve Docker stack'ine karşı smoke testler (`tests/smoke/`); publish bu workflow'a `needs:` ile bağlı. API lint hâlâ dışarıda.)_
- [ ] **Node 20 EOL.** Node 20'nin desteği 30 Nisan 2026'da bitti; Dockerfile (`node:20-bookworm-slim`) ve CI Node 22 LTS'e taşınmalı (Prisma 5 uyumluluğu doğrulanarak).

## 1. Faz 2 — Otomasyon ve kanıt

- [ ] **Bulk result ingestion için web UI.** Backend'de `POST .../results/bulk` zaten var; arayüzde toplu görüntüleme/yükleme ekranı yok.
- [ ] **JUnit XML içe aktarma.** FR-078: generic REST + JUnit XML ilk otomasyon girişi olarak tanımlanmış; JUnit XML parse edip `bulkSubmit`'e çeviren bir endpoint/CLI yok.
- [ ] **İlk framework reporter'ı (Playwright veya pytest).** Henüz hiç reporter paketi yazılmadı.
- [ ] **Attachment upload/download UI.** API tarafı tam (`attachments.controller.ts`), ama web'de dosya yükleme/indirme ekranı yok — sadece backend REST ile mümkün.
- [ ] **Run geçmişi / dashboard.** Şu an sadece tek run'ın progress'i gösteriliyor; proje genelinde geçmiş runlar, pass-rate trendi, son failed testler yok (FR-060, FR-061).
- [ ] **Gelişmiş filtreleme/arama.** FR-061: case/requirement/run/tarih/status/kullanıcı/tag/milestone'a göre filtre — şu an yok.
- [ ] **API rate limit + idempotency iyileştirmeleri.** (0. madde ile birlikte ele alınabilir.)

## 2. Faz 3 — Entegrasyon ve ekip ölçeği

- [ ] **Jira/GitHub issue bağlantıları (gerçek adapter).** Şu an `Defect.externalProvider/externalIssueId/externalUrl` sadece serbest metin alanı; FR-053'teki adapter mimarisi (otomatik issue oluşturma, durum eşitleme) yok.
- [ ] **Webhook altyapısı.** FR-079: run tamamlanma, sonuç oluşturma, defect değişikliği olaylarına abonelik + retry/başarısız teslimat görünürlüğü — yok.
- [ ] **Chat bildirim entegrasyonları** (Slack/Teams/Discord/Mattermost) — webhook altyapısına bağımlı, henüz yok.
- [ ] **Özel alanlar (custom fields) için UI.** Backend'de `TestCase.customFields` (Json) zaten var ama proje bazlı alan şeması tanımlama/gösterme arayüzü yok.
- [ ] **Case review akışı, rapor paylaşımı, ek reporter'lar.**
- [ ] **CSV içe/dışa aktarma.** FR-062.

## 3. Web arayüzünde eksik ekranlar (Faz 1 kapsamında backend hazır, UI minimal/yok)

**Arayüz yenilendi (2 Ekim 2026):** Qase benzeri iş akışı (sol proje navigasyonu, suite ağacı + case tablosu + detay paneli, run ilerleme şeridi ve satır içi sonuç girişi, plan/run/requirement dialoglarında ortak case seçici) kendi görsel kimliğiyle; marka/görsel tasarım kopyalanmadı (design-doc bölüm 1). WCAG 2.2 AA: axe taramasında ihlal yok, 390 px'te yatay kaydırma yok. Planlar sayfasının ilk planla çökmesi giderildi.

- [ ] Milestone yönetimi ekranı (API'de yalnızca list/create var; update/delete yok, UI yok).
- [x] API token oluşturma/iptal ekranı (API var, UI yok). _(2 Ekim 2026: Hesabım sayfasında; token yalnızca bir kez gösterilir, iptal onay ister. İptal yanıtı artık tokenHash döndürmüyor.)_
- [ ] Run "public share" linkini açma/kapama ekranı (API var, UI yok).
- [x] Workspace/project üye yönetimi ekranı — listeleme, ekleme, rol güncelleme ve çıkarma UI'ın hiçbiri yok (MVP kabul kriteri 1 şu an yalnızca API ile karşılanıyor). _(2 Ekim 2026: workspace "Üyeler" sekmesi ve proje "Üyeler" bölümü; açıklamalı rol seçimi; yeni hesap admin tarafından geçici parolayla oluşturulabilir. Arayüz kullanıcının rolüne göre eylemleri gizler, sidebar'da rol görünür.)_
- [x] Kullanıcı kaydı ve hesap ayarları. _(Kayıt ekranı (`SELF_REGISTRATION`, varsayılan açık), profil ve parola değiştirme; e-posta eşleşmesi büyük/küçük harf duyarsız.)_
- [x] Üyelik güvenliği. _(Projeye yalnızca workspace üyeleri eklenebilir; workspace'ten çıkarılan kişinin o workspace'teki proje üyelikleri de silinir (önceden projelere erişmeye devam ediyordu); workspace'in son admin'i çıkarılamaz/düşürülemez; üyeler yalnızca üyesi oldukları projelerin adlarını görür. `tests/smoke/users.mjs`: 33 senaryo.)_
- [ ] Parola sıfırlama ve e-posta daveti — SMTP altyapısı yok; şu an admin yeni hesabı geçici parolayla oluşturuyor, unutulan parolayı sıfırlamanın yolu yok (admin'in başka kullanıcının parolasını sıfırlaması da yok).
- [ ] Giriş/kayıt için rate limit — kayıt endpoint'i herkese açık; bölüm 0'daki rate limiting maddesi artık daha öncelikli.
- [x] Suite hiyerarşisi (alt suite/klasör ağacı) — şu an tek seviye liste. _(2 Ekim 2026: Repository'de iç içe suite ağacı, alt suite'ler dahil sayaçlar ve ağaç sırasıyla gruplanmış case listesi.)_
- [ ] Adım bazlı (step-level) sonuç girme — şu an case bazlı tek durum.
- [ ] Düzenleme/arşivleme/silme — web hiçbir yerde `PATCH`/`DELETE` çağırmıyor; case, requirement, plan, run, defect yalnızca oluşturulabiliyor (FR-011).
- [x] Requirement coverage görünümü (FR-022, akış 5.1 adım 3). _(Requirement listesinde testsiz etiketi ve son sonuç şeridi.)_
- [ ] Case değişiklik geçmişi (FR-015) — API var, UI yok.
- [x] Arayüz dili İngilizce. _(2 Ekim 2026: tüm arayüz metinleri, API hata mesajları, seed ve başlatma script çıktıları İngilizce; kod yorumları Türkçe kaldı. Tarihler `en-US`; aramada i/ı/İ farkı yok sayılıyor. Çoklu dil (i18n) altyapısı yok — ikinci bir dil gerekirse metinler bir sözlüğe taşınmalı.)_
- [x] Açık/koyu tema. _(Sistem / Açık / Koyu seçimi üst barda ve giriş ekranında; tercih tarayıcıda saklanır, sekmeler arası eşitlenir; `public/theme-init.js` ilk çizimden önce uygular (CSP satır içi script'e izin vermediği için ayrı dosya). İki temada 11 sayfanın axe taraması temiz.)_

## 4. Yayın — container registry publish

**Tekrarlanabilir build:** `package.json` `packageManager: pnpm@12.8.1` — Docker (corepack), CI (`pnpm/action-setup`) ve yerel pnpm aynı sürümü kullanır; sürüm lockfile'da integrity ile kayıtlı.

**Mevcut durum (2 Ekim 2026):** Elle adım yok. `release.yml` master'a her push/merge'de (yalnızca `.md` değişiklikleri hariç) CI'ı çalıştırır, `scripts/next-version.sh` ile sürümü hesaplar (ilk sürüm `package.json`'dan; sonra `feat:` → minor, `type!:` / `BREAKING CHANGE:` → major, diğerleri → patch), imajı `ghcr.io/caslanqa/testops`'a yayınlar, anonim çekilebildiğini doğrular ve ardından `vX.Y.Z` tag'i + GitHub Release (otomatik notlar) oluşturur. Tag `GITHUB_TOKEN` ile oluşturulduğu için başka workflow tetiklemez; yayın aynı run içindedir.

- [x] **Repo henüz git/GitHub'da değil** — workflow hiç çalışamaz. _(2 Ekim 2026: `github.com/caslanqa/test-ops`; ilk `v0.1.0` master'a ilk merge'de otomatik çıkar.)_
- [x] **Publish öncesi kalite kapısı yok.** _(`ci.yml` reusable workflow olarak çağrılıyor.)_ Build/typecheck/test geçmeden imaj yayınlanıyor → ayrı CI job'u ve publish'te `needs:`.
- [x] **Yalnızca linux/amd64.** _(QEMU + `linux/amd64,linux/arm64`; GHCR için index annotation'ları.)_ Apple Silicon / ARM sunucularda emülasyonla çalışır → `setup-qemu-action` + `platforms: linux/amd64,linux/arm64`.
- [x] **Sürümsüz build `latest` oluyor.** _(raw satırı kaldırıldı; `{{major}}.{{minor}}` tag'i eklendi.)_ `type=raw,value=latest,enable={{is_default_branch}}` manuel tetiklemede main'i `latest` yapıyor; semver tag'lerinde `latest` zaten `flavor: latest=auto` ile üretildiği için bu satır kaldırılmalı.
- [x] **Docker Hub (opsiyonel).** _(Karar, 2 Ekim 2026: yalnızca GHCR; Docker Hub eklenmeyecek.)_
- [x] **GHCR paket görünürlüğü.** _(`GITHUB_TOKEN` ile yayınlanan paket public repo'nun görünürlüğünü devralır; publish job'ı anonim `imagetools inspect` ile doğrular, çekilemezse uyarı verir.)_
- [x] **Otomatik sürümleme ve release.** _(Elle tag yok; bkz. yukarıdaki akış ve `scripts/next-version.sh`.)_
- [ ] **Pull tabanlı kurulum.** Mevcut `docker-compose.yml` `build:` içeriyor; yalnızca `image:` kullanan bir release compose dosyası + kurulum/upgrade/yedekleme README'si (bölüm 0'daki backup maddesiyle birlikte).
- [ ] **İmaj sertleştirme.** Non-root kullanıcı (mevcut root-sahipli volume'lar için geçiş adımıyla), SBOM/provenance (`sbom: true`), opsiyonel cosign imzası.

## Önerilen sıradaki adım

En yüksek değer/efor oranına göre önerilen sıra:
1. Projeler/workspace'ler arası ID doğrulaması + JWT secret zorunluluğu (0.1 — aktif güvenlik açıkları, küçük efor).
2. Attachment güvenliği + Postgres portu + audit log + rate limiting.
3. Bulk submit atomikliği, idempotency yarışı, coverage hatası, FR-072 sayfalama.
4. Lint/CI kapısı + smoke e2e testler + registry publish iyileştirmeleri (bölüm 4; CI kapısıyla aynı workflow işi).
5. Attachment upload UI + milestone/API-token/share/üye yönetimi UI'ları (backend zaten hazır, sadece frontend işi).
6. JUnit XML içe aktarma + ilk reporter (otomasyon değerini gösterir).
7. Dashboard/geçmiş/filtreleme (kullanım arttıkça değeri artar).
8. Jira/GitHub + webhook entegrasyonları (en yüksek efor, en dış bağımlılık).

Hangi maddeyle devam edileceğini onaylayın, o maddeden başlanır.
