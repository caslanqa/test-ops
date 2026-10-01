# TestOps - Ürün Tasarım ve Gereksinim Dokümanı

**Sürüm:** 0.2 (taslak)  
**Tarih:** 1 Ekim 2026  
**Ürün yaklaşımı:** Qase benzeri iş akışları; bağımsız ürün, self-hosted dağıtım  
**Dağıtım:** Docker image + Docker Compose  
**Veritabanı:** PostgreSQL

## 1. Amaç ve vizyon

TestOps; test case’lerin yönetildiği, gereksinimlerle ilişkilendirildiği, manuel ve otomatik testlerin ortak plan/run modeliyle yürütüldüğü ve sonuçların dış sistemlere açıldığı bir test yönetim platformudur.

Ürün yalnızca test case deposu değildir. Web arayüzü, public REST API, CI/test framework reporter’ları ve issue tracker entegrasyonları aynı test verisini kullanır. Test planı manuel QA ile otomasyon arasındaki bağı kurar; her sonuç ilgili case, gereksinim, run ve kanıt dosyalarıyla izlenebilir olur.

Qase’in ürün kapsamı ve public dokümantasyonu işlevsel referans olarak alınır; marka, görsel tasarım veya tescilli kod kopyalanmaz.

## 2. Kapsam ve temel kararlar

- Uygulama self-hosted Docker dağıtımını destekler.
- PostgreSQL tek desteklenen veritabanıdır.
- ZIP, JPEG ve benzeri ek dosyaların içeriği PostgreSQL'e yazılmaz; PostgreSQL ek metadata'sını tutar, dosyalar kalıcı Docker volume'unda saklanır.
- Uygulama, API ve arka plan işleri modüler monolith olarak başlar; ilk aşamada mikroservis hedeflenmez.
- Her kurulum bir veya daha fazla workspace ve workspace içinde birden fazla project barındırabilir.
- Issue alanı test kaynaklı defect takibine odaklanır; Jira benzeri genel amaçlı issue tracker yapılmaz.
- Public API ve otomatik test sonuçlarının alınması ilk sürümün temel yeteneklerindendir.

## 3. Kullanıcılar ve yetkiler

| Rol | Temel yetkiler |
| --- | --- |
| Workspace Admin | Üyeleri, workspace ayarlarını ve projeleri yönetir. |
| Project Admin / QA Lead | Repository, requirement, plan, run, alanlar ve proje ayarlarını yönetir. |
| Tester | Atandığı run’ları yürütür; sonuç, yorum ve kanıt ekler. |
| Developer / Automation | API token’ı ile test sonuçları gönderir ve izin verilen verileri okur. |
| Viewer | Proje verilerini ve raporları salt okunur görüntüler. |

Yetkiler workspace ve project sınırlarında kontrol edilir. API işlemleri de kullanıcı rolü ve token izinlerine tabidir. Hassas API token’ları sadece sunucu/CI tarafında tutulmalıdır.

## 4. Alan modeli ve kavramlar

- **Workspace:** Kullanıcıların ve projelerin yönetildiği üst seviye alan.
- **Project:** Test repository’si, requirements, plans, runs ve raporların sınırı.
- **Suite:** Test case’leri hiyerarşik olarak düzenleyen klasör/kategori.
- **Test case:** Kalıcı ve dışarıdan referans verilebilir benzersiz kimliği olan test tanımı. Başlık, önkoşul, adımlar, beklenen sonuç, öncelik, severity, test tipi, otomasyon durumu, etiketler ve özel alanlar içerebilir.
- **Requirement:** Test kapsamı izlenen iş/ürün gereksinimi. Test case’lerle çoktan çoğa bağlanır.
- **Test plan:** Bir hedef, sürüm veya milestone için seçilmiş test case’leri ve isteğe bağlı atamaları içeren küratörlü liste.
- **Test run:** Bir planın veya ad hoc seçimin belirli ortam/konfigürasyondaki yürütme örneği. Bir run manuel ve otomatik sonuçları birlikte taşıyabilir.
- **Result:** Bir run içindeki test case yürütme sonucu; status, tester/automation kaynağı, zaman, süre, yorum, step sonuçları ve ekleri tutar.
- **Defect:** Test sırasında bulunan hata kaydı. Bir veya daha fazla failed result ile ilişkilendirilebilir ve dış issue bağlantısı taşıyabilir.
- **Milestone, environment, configuration:** Sürüm/teslimat hedefini ve yürütme koşullarını sınıflandırır.
- **Attachment:** Sonuç veya adımla ilişkilendirilmiş screenshot, log, video veya rapor gibi kanıt. Dosyanın kendisi kalıcı dosya deposunda; adı, MIME tipi, boyutu, checksum'u ve storage key'i PostgreSQL'de tutulur.

Plan ve run ayrımı korunur: plan tekrar kullanılabilir test kapsamıdır; run belirli bir zamandaki gerçek yürütmedir. Run başlatıldığında case kimliği ve ilgili case sürümü/snapshot’ı kaydedilir; böylece repository sonradan değişse de geçmiş sonuçların bağlamı korunur.

## 5. Ana kullanıcı akışları

### 5.1 Gereksinimden kapsama

1. Kullanıcı project içinde requirement oluşturur veya içe aktarır.
2. Requirement bir ya da daha fazla test case’e bağlanır.
3. Coverage görünümü hangi requirement’ların testsiz, bağlı veya son yürütmede başarısız olduğunu gösterir.

### 5.2 Plan üzerinden manuel ve otomatik yürütme

1. QA Lead plan oluşturur; case’leri, milestone’u, environment/configuration’ı ve isteğe bağlı tester atamalarını seçer.
2. Plan üzerinden run başlatılır; run seçilmiş case’lerin snapshot’ıyla oluşur.
3. Tester’lar web arayüzünden sonuç girer. CI reporter’ları aynı run ID’ye API ile sonuç yollar.
4. Run; kalan, geçen, başarısız ve bloklanan testleri, son aktiviteleri ve tamamlanma oranını gösterir.
5. Tüm sonuçlar hazır olduğunda yetkili kullanıcı veya CI run’ı tamamlar.

### 5.3 Başarısız sonuçtan defect

Tester veya entegrasyon failed result içinden defect oluşturur; adımlar, beklenen/gerçek sonuç, kanıtlar ve ilgili case/run otomatik bağlanır. Defect iç sistemde izlenebilir; daha sonra Jira/GitHub gibi sistemlere referansla bağlanabilir.

## 6. Fonksiyonel gereksinimler

### 6.1 Workspace ve project

- **FR-001:** Kullanıcı workspace ve project oluşturabilmeli; project’ler benzersiz kodla tanımlanmalı.
- **FR-002:** Workspace/project üyeleri ve roller yönetilebilmeli.
- **FR-003:** Her veri sorgusu kullanıcının yetkili olduğu workspace/project ile sınırlandırılmalı.

### 6.2 Test repository

- **FR-010:** Kullanıcı suite hiyerarşisi oluşturup yeniden düzenleyebilmeli.
- **FR-011:** Test case oluşturma, görüntüleme, düzenleme, arşivleme ve silme desteklenmeli.
- **FR-012:** Case adımları eylem/beklenen sonuç çiftleri halinde tutulmalı; önkoşullar ve açıklama desteklenmeli.
- **FR-013:** Öncelik, severity, type, automation status, etiket ve özel alanlar tanımlanabilmeli.
- **FR-014:** Case ID değişmeden kalmalı; case adı veya suite’i değişse de otomasyon sonuçlarının bağlantısı korunmalı.
- **FR-015:** Değişiklik geçmişi ve temel audit kaydı görüntülenebilmeli.
- **FR-016:** Ortak adımlar (shared steps) ve parametrik test verisi sonraki faz için veri modelinde genişletilebilir olmalı.
- **FR-017:** Otomasyon sonucu case eşleştirmesi önce case ID’si, bulunamazsa isim/suite yolu ile yapılmalı. Hiçbiri eşleşmezse sistem yeni case’i otomatik oluşturup otomasyon kaynaklı olarak işaretlemeli; hangi sonuç durumlarından (ör. yalnızca passed veya tüm durumlar) otomatik case oluşturulacağı proje ayarından yapılandırılabilir olmalı.

### 6.3 Requirements traceability

- **FR-020:** Requirement oluşturma, düzenleme, arşivleme ve dış referans saklama desteklenmeli.
- **FR-021:** Requirement–case ilişkisi çoktan çoğa olmalı.
- **FR-022:** Coverage raporu testsiz requirement’ları ve son test durumlarını göstermeli.
- **FR-023:** Requirement’a bağlı case’lerin değişiklik ve yürütme geçmişi izlenebilmeli.

### 6.4 Plans ve runs

- **FR-030:** Planlar case koleksiyonu, açıklama, milestone, environment/configuration ve atama içerebilmeli.
- **FR-031:** Aynı plan birden fazla run üretmek üzere tekrar kullanılabilmeli.
- **FR-032:** Run plan üzerinden veya ad hoc case seçimiyle başlatılabilmeli.
- **FR-033:** Run başlığı, açıklaması, etiketleri, environment’ı, build/sürüm bilgisini, milestone’u, kaynağı (manual/CI) ve dış bağlantıları tutmalı.
- **FR-034:** Bir run hem manuel hem otomatik sonuç kabul edebilmeli; birden fazla CI job aynı run’a sonuç ekleyebilmeli.
- **FR-035:** Run açık/tamamlandı durumlarını desteklemeli. Tamamlanan run’a yeni sonuç ekleme davranışı yetki ve ayarla kontrol edilmeli.
- **FR-036:** API, bir plana bağlı case ID listesini döndüren bir endpoint sunmalı; otomasyon istemcileri bu listeyi kullanarak yalnızca plandaki testleri çalıştırabilmeli (seçici çalıştırma / selective execution).

### 6.5 Execution ve sonuçlar

- **FR-040:** Test sonucu en az Passed, Failed, Blocked, Skipped ve Untested durumlarını desteklemeli.
- **FR-041:** Manuel yürütmede her case ve adım için sonuç, yorum ve kanıt kaydedilebilmeli.
- **FR-042:** Sonuç; run, case, kullanıcı/automation kaynağı, başlangıç/bitiş zamanı ve süre ile ilişkilendirilmeli.
- **FR-043:** Tekrar denemeler geçmişi kaybetmeden görülebilmeli; güncel durum ile önceki denemeler ayırt edilmeli.
- **FR-044:** Failed sonuçtan defect açılabilmeli.
- **FR-045:** Eklere dosya boyutu/türü sınırları ve yetkili erişim uygulanmalı (başlangıç referansı: dosya başına ~32 MB, istek başına toplam ~128 MB, istek başına en fazla ~20 dosya; kesin değerler yapılandırılabilir olmalı).
- **FR-046:** Ek dosya içeriği kalıcı dosya deposuna yazılmalı; metadata ve test sonucu ilişkisi PostgreSQL'de saklanmalı.

### 6.6 Defect ve issue bağlantıları

- **FR-050:** İç defect kaydı başlık, açıklama, severity, durum, sorumlu, etiket ve ilişkilendirilmiş sonuçları tutmalı.
- **FR-051:** Aynı defect birden fazla test sonucuna bağlanabilmeli.
- **FR-052:** Dış sistem linki için provider, dış issue ID ve URL saklanmalı. Provider alanı genişleyebilir bir liste olmalı (ör. Jira, GitHub, GitLab, Azure DevOps, Linear, Trello, YouTrack, özel/custom).
- **FR-053:** Entegrasyonlar geldiğinde dış issue oluşturma ve durum eşitleme adapter üzerinden yapılmalı; çekirdek domain provider’a bağımlı olmamalı.

### 6.7 Dashboard, rapor ve arama

- **FR-060:** Proje dashboard’u run ilerlemesi, sonuç dağılımı, son failed testler ve requirement coverage göstermeli.
- **FR-061:** Test geçmişi case, requirement, run, tarih, status, kullanıcı, tag ve milestone’a göre filtrelenebilmeli.
- **FR-062:** CSV içe/dışa aktarma ve run raporunu paylaşma sonraki fazda genişletilebilmeli.
- **FR-063:** Public run paylaşım linki ayrıcalıklı ve kapatılabilir olmalı; tahmin edilemeyen token kullanmalı.

### 6.8 Public API ve otomasyon

- **FR-070:** `/api/v1` altında belgelenmiş REST API sunulmalı; OpenAPI şeması üretilmeli.
- **FR-071:** API en az project, suites, cases, requirements, plans, runs, results, defects ve attachments kaynaklarını desteklemeli.
- **FR-072:** Listeleme endpoint’leri sayfalama, filtreleme ve sıralama sağlamalı.
- **FR-073:** API token’ları iptal edilebilir olmalı; token oluşturma/son kullanım audit edilmelidir.
- **FR-074:** Sonuçlar tekil ve toplu gönderilebilmeli; toplu istek boyutu sınırlandırılmalı.
- **FR-075:** Sonuç gönderimi idempotent olmalı veya dış test kimliği/run kimliği üzerinden yinelenen kayıtları saptayabilmeli.
- **FR-076:** Otomasyon, var olan run’a sonuç gönderebilmeli; plan kimliği üzerinden run oluşturma akışı desteklenmeli.
- **FR-077:** Hata gövdeleri, HTTP kodları, rate limit ve `Retry-After` davranışı dokümante edilmeli; rate limit durumu `RateLimit-Policy`/`RateLimit` (veya eşdeğer `X-RateLimit-*`) header’larıyla istemciye bildirilmeli, limit aşımında HTTP 429 ve `Retry-After` döndürülmeli.
- **FR-078:** İlk otomasyon girişi generic REST API ve JUnit XML içe alımıdır. Framework’e özel reporter paketleri sonraki fazlarda eklenir.
- **FR-079:** Run tamamlanma, sonuç oluşturma ve defect değişikliği gibi olaylar için webhook altyapısı sonraki fazda eklenebilir; retry ve başarısız teslimat görünürlüğü gerekir.

## 7. Mimari ve dağıtım gereksinimleri

- Uygulama tek versiyonlu OCI/Docker image olarak yayımlanır; container stateless çalışır.
- Docker Compose başlangıç dağıtımı uygulama, PostgreSQL ve kalıcı volume’ları içerir. Worker gerekirse aynı image’ın ayrı process/servisi olarak çalışır.
- PostgreSQL verisi named volume’da tutulur; yeniden başlatma/upgrade sırasında silinmez.
- İlk sürümde ek dosyaları uygulamanın container dosya sistemine değil, uygulamaya bağlanan kalıcı Docker volume'una yazılmalı (ör. `/data/attachments`). PostgreSQL yalnızca dosya metadata'sını ve storage key'i tutmalı; ekler veritabanına BLOB olarak yazılmamalı.
- İlk sürüm için ayrı bir object-storage servisi zorunlu değildir. İleride aynı storage arayüzünün S3-uyumlu depoya yönlendirilmesi mümkün olmalı.
- Yapılandırma environment variable/secret üzerinden verilir; DB parola ve API token’ları image’a gömülmez.
- Uygulama DB hazır olana kadar kontrollü bekler; schema migration’ları versiyonlu ve yedekleme/upgrade yönergesiyle yayımlanır.
- Health/readiness endpoint’leri ve yapılandırılabilir log seviyesi bulunur.
- İlk sürüm yatay ölçeklemeyi zorunlu kılmaz; API ve worker’ın aynı PostgreSQL verisini güvenli kullanması gerekir.

## 8. Güvenlik, güvenilirlik ve kalite

- Kimlik doğrulama ve RBAC web ve API’de aynı domain izinlerini kullanmalı.
- Her sorgu workspace/project erişimini kontrol etmeli; nesne ID tahmini veri sızıntısına yol açmamalı.
- Parolalar güvenli password hashing ile saklanmalı; token’lar oluşturulduktan sonra tekrar gösterilmemeli veya hash’lenmiş saklanmalı.
- Dosya yüklemeleri boyut, uzantı/MIME ve erişim kontrolünden geçmeli.
- Kritik kullanıcı işlemleri audit log’a yazılmalı.
- PostgreSQL ile attachment volume'unun yedekleme ve geri yükleme prosedürü dokümante edilmeli; upgrade öncesi ikisi de yedeklenebilmeli.
- API cevapları, migration ve entegrasyon hataları gözlemlenebilir olmalı; sessizce kaybolan test sonuçları kabul edilmez.

## 9. MVP kabul ölçütleri

1. Admin workspace/project oluşturup kullanıcıya rol atayabilir.
2. QA Lead suite, test case ve requirement oluşturup requirement’ı case’e bağlayabilir.
3. Kullanıcı plan oluşturabilir, case seçebilir ve plan üzerinden run başlatabilir.
4. Tester run içindeki case’i Passed/Failed/Blocked/Skipped olarak tamamlayıp yorum/ek ekleyebilir.
5. Failed sonuçtan iç defect oluşturulabilir; defect test sonucu ve case’e geri bağlanır.
6. REST API ile case/plan/run okunup yönetilebilir ve otomasyon sonucu run’a gönderilebilir.
7. Docker Compose kurulumu PostgreSQL verisini ve attachment volume'undaki dosyaları restart sonrasında korur; yedekleme yönergesi ikisini de kapsar.
8. Run görünümü manuel ve API’den gelen sonuçları aynı ilerleme/rapor içinde gösterir.

## 10. Önerilen teslimat fazları

**Faz 1 - Çalışan çekirdek:** Workspace/project ve roller, test repository, requirements traceability, plans, manuel runs, sonuçlar, iç defect, PostgreSQL/Docker, API token ve temel REST API.

**Faz 2 - Otomasyon ve kanıt:** Bulk result ingestion, JUnit XML, attachment depolaması, Playwright veya pytest için ilk reporter, run geçmişi/dashboard, API rate limit ve idempotency iyileştirmeleri.

**Faz 3 - Entegrasyon ve ekip ölçeği:** Jira/GitHub issue bağlantıları, webhook’lar (ör. Slack/Microsoft Teams/Discord/Mattermost gibi kanallara run tamamlanma ve defect bildirimleri), gelişmiş filtreleme/arama, özel alanlar, case review, rapor paylaşımı ve ek reporter’lar.

**MVP dışında:** Genel amaçlı issue tracker, test framework’ü/runner’ı barındırma, çok sayıda çift yönlü entegrasyon, AI ile case üretimi ve gelişmiş kurumsal analiz. Bunlar çekirdek akışlar doğrulandıktan sonra değerlendirilir.

## 11. Varsayımlar ve açık kararlar

- İlk dağıtım bir kuruluşun kendi sunucusunda çalışır; workspace/project ayrımı korunur.
- MVP’de yerel kullanıcı/parola ile kimlik doğrulama varsayılır; OIDC/LDAP kurumsal faza bırakılır.
- İç defect takibi MVP’de vardır; ilk dış tracker entegrasyonu için Jira veya GitHub daha sonra seçilecektir.
- İlk framework reporter’ı kullanıcıların otomasyon yığınına göre seçilmelidir; bu dokümanda JUnit XML genel başlangıç kabul edilmiştir.
- Başlangıç performans hedefleri gerçek kullanım ve yük testiyle belirlenecektir.
- Requirement içeriğinin Jira/GitHub gibi dış sistemlerden otomatik senkronizasyonu MVP dışıdır; MVP’de yalnızca dış referans (ID/URL) saklanır, içerik elle veya içe aktarmayla girilir.

## 12. Referanslar

- [Qase ürün sayfası](https://www.qase.io/product/)
- [Qase entegrasyonları](https://www.qase.io/integrations/)
- [Qase API giriş ve kimlik doğrulama](https://developers.qase.io/reference/introduction-to-the-qase-api)
- [Test planları ve manuel/otomatik sonuçların birleştirilmesi](https://developers.qase.io/docs/test-plans)
- [Reporter’ların çalışma biçimi](https://developers.qase.io/docs/start-here)
- [Test case kimliğiyle otomasyon eşleştirme](https://developers.qase.io/docs/linking-tests)
- [Run yapılandırması ve mevcut run’a sonuç gönderimi](https://developers.qase.io/docs/test-runs)
- [Test sonuçlarına attachment ekleme](https://developers.qase.io/docs/attachments)
