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
- [x] **Attachment güvenliği.** _(2 Ekim 2026: uzantı allowlist'i (`ATTACHMENT_ALLOWED_EXTENSIONS`, varsayılanda svg yok) ve sunucuda uzantıdan türetilen Content-Type; `res.attachment` ile RFC 6266 `filename*`; multer disk storage (volume içi `.tmp` + atomik rename, akış ile checksum, reddedilende temizlik); `Content-Length` ile gövde okunmadan 413; ATTACHMENT_* limitleri compose'dan yapılandırılabilir ve geçersiz değerde uygulama başlamıyor. Ek olarak: Türkçe dosya adlarının DB'ye bozuk (`gÃ¶rÃ¼ntÃ¼`) kaydedilmesi düzeltildi, doğrudan `multer` bağımlılığı CVE'li 1.4.5-lts'ten Nest'in kullandığı 2.0.2'ye eşitlendi. 18 senaryolu smoke test geçti. İçerik/magic-byte doğrulaması yok.)_
  - Bölüm 8'deki MIME/uzantı kontrolü yok (sadece boyut).
  - `attachments.controller.ts` dosya adını `Content-Disposition`'a ham yazıyor; Latin-1 dışı karakterli adlar (ş, ğ, ı) indirmede 500 verir, `"` header'ı bozar → RFC 5987 `filename*=UTF-8''…`.
  - `memoryStorage`: toplam 128 MB kontrolü dosyalar RAM'e alındıktan sonra yapılıyor (tek istek ~640 MB) → disk tabanlı storage veya stream.
- [ ] **Küçükler.** Token iptal yanıtı `tokenHash` döndürüyor; container root olarak çalışıyor.

**Doğruluk / fonksiyonel**

- [ ] **FR-072 yok.** Hiçbir listeleme endpoint'inde sayfalama/sıralama yok.
- [ ] **Coverage hatası.** `requirements.service.ts` `take: 200` tüm bağlı case'lerin sonuçlarını birlikte kesiyor; çok çalıştırılan case'lerde diğer case'lerin son durumu kayboluyor. Ayrıca requirement başına N+1 sorgu.
- [ ] **Bulk submit atomik değil.** `results.service.ts` `bulkSubmit` sıralı ve transaction'sız; tek hatalı öğede 404 döner ama önceki sonuçlar yazılmış kalır, istemci hangilerinin kaydedildiğini bilemez.
- [ ] **Idempotency yarışı.** `externalTestId` kontrolü transaction dışında; eşzamanlı CI job'ları çift kayıt üretebilir. Eski bir attempt'in `externalTestId`'si gelirse `RunCase.status` eski sonuca çekiliyor.
- [x] **Silme/bağlantı kaldırma 500 dönüyor.** Prisma `delete` kayıt yoksa P2025 fırlatıyor, global exception filter yok → 404 yerine 500. _(Bağlantı silmeler `deleteMany` + 404'e çevrildi, diğer silmeler önce varlık kontrolü yapıyor. Genel bir Prisma exception filter hâlâ yok.)_

**Araç zinciri**

- [ ] **API lint kırık.** `pnpm lint` → `eslint: command not found`; eslint ne kurulu ne yapılandırılmış.
- [ ] **CI kapısı yok.** Tek workflow tag'de Docker publish; PR/push'ta build + typecheck + test yok.

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

- [ ] Milestone yönetimi ekranı (API'de yalnızca list/create var; update/delete yok, UI yok).
- [ ] API token oluşturma/iptal ekranı (API var, UI yok).
- [ ] Run "public share" linkini açma/kapama ekranı (API var, UI yok).
- [ ] Workspace/project üye yönetimi ekranı — listeleme, ekleme, rol güncelleme ve çıkarma UI'ın hiçbiri yok (MVP kabul kriteri 1 şu an yalnızca API ile karşılanıyor).
- [ ] Suite hiyerarşisi (alt suite/klasör ağacı) — şu an tek seviye liste.
- [ ] Adım bazlı (step-level) sonuç girme — şu an case bazlı tek durum.
- [ ] Düzenleme/arşivleme/silme — web hiçbir yerde `PATCH`/`DELETE` çağırmıyor; case, requirement, plan, run, defect yalnızca oluşturulabiliyor (FR-011).
- [ ] Requirement coverage görünümü (FR-022, akış 5.1 adım 3) ve case değişiklik geçmişi (FR-015) — API var, UI yok.

## 4. Yayın — container registry publish

**Mevcut durum:** `.github/workflows/docker-publish.yml`, `v*.*.*` tag push'unda ve manuel tetiklemede imajı GHCR'ye (`ghcr.io/<owner>/testops`) semver + `sha` + `latest` tag'leriyle yayınlıyor. Docker Hub desteği yok.

- [ ] **Repo henüz git/GitHub'da değil** — workflow hiç çalışamaz. `git init` + GitHub repo + ilk `v0.1.0` tag'i gerekli.
- [ ] **Publish öncesi kalite kapısı yok.** Build/typecheck/test geçmeden imaj yayınlanıyor → ayrı CI job'u ve publish'te `needs:`.
- [ ] **Yalnızca linux/amd64.** Apple Silicon / ARM sunucularda emülasyonla çalışır → `setup-qemu-action` + `platforms: linux/amd64,linux/arm64`.
- [ ] **Sürümsüz build `latest` oluyor.** `type=raw,value=latest,enable={{is_default_branch}}` manuel tetiklemede main'i `latest` yapıyor; semver tag'lerinde `latest` zaten `flavor: latest=auto` ile üretildiği için bu satır kaldırılmalı.
- [ ] **Docker Hub (opsiyonel).** `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secret'ları tanımlıysa aynı imajı `docker.io/<kullanıcı>/testops`'a da push eden adım; tanımlı değilse atlanır.
- [ ] **GHCR paket görünürlüğü.** Yeni GHCR paketleri private açılır; self-hosted kullanıcıların auth'suz çekebilmesi için paket bir kez public yapılmalı (GitHub UI).
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
