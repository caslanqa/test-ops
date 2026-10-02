# TestOps

Test case yönetimi, test run'ları ve otomasyon sonuçlarını tek yerde toplayan, kendi sunucunuzda çalıştırabileceğiniz bir test yönetim aracı. API ve web arayüzü tek bir Docker imajında gelir; veriler ayrı bir PostgreSQL veritabanında tutulur.

- İmaj: `ghcr.io/caslanqa/testops` (linux/amd64 ve linux/arm64, herkese açık)
- Gereksinim: Docker Engine 24+ ve Docker Compose v2 (`docker compose version` ile kontrol edin)

## Hızlı başlangıç (önerilen)

Kaynak koda gerek yoktur; iki dosya ve üç komut yeterlidir.

```bash
mkdir testops && cd testops

# 1. Compose dosyasını indirin (PostgreSQL + TestOps)
curl -fsSLO https://raw.githubusercontent.com/caslanqa/test-ops/master/docker-compose.yml

# 2. Zorunlu iki secret'ı içeren .env dosyasını oluşturun
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
EOF

# 3. Başlatın; --wait uygulama hazır olana kadar bekler (ilk seferde imajlar indirilir)
docker compose up -d --wait
```

Ardından tarayıcıda **http://localhost:8080** adresini açın.

> `.env` dosyası secret içerir; saklayın ve paylaşmayın. Özellikle `POSTGRES_PASSWORD` ilk kurulumdan sonra değiştirilmemelidir (bkz. [Sorun giderme](#sorun-giderme)).

### İlk giriş

Yeni kurulumda hiç kullanıcı yoktur. İki seçeneğiniz var:

- **Hesap oluşturun:** Giriş ekranındaki **Create account** bağlantısıyla kaydolun, sonra **New workspace** ile ilk workspace'inizi oluşturun. Workspace'i oluşturan kişi onun admin'i olur ve diğer kullanıcıları buradan ekler.
- **Demo veri yükleyin:** Örnek bir workspace, proje ve admin kullanıcısı oluşturur.

  ```bash
  docker compose exec -e SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)" app node prisma/seed.js
  ```

  Komut, giriş bilgilerini `Seed complete. Sign in with: admin@testops.local / …` satırında yazdırır; e-posta `SEED_ADMIN_EMAIL` ile değiştirilebilir. `SEED_ADMIN_PASSWORD` verilmezse parola `ChangeMe123!` olur; bu durumda girişten sonra **Account** sayfasından hemen değiştirin. Komutu tekrar çalıştırmak güvenlidir: var olan kayıtlara ve kullanıcının parolasına dokunmaz, bunu çıktıda da belirtir.

`SELF_REGISTRATION=false` ile kaydı kapattıysanız ilk kullanıcıyı demo veri komutuyla oluşturun.

## Günlük işlemler

Komutları `docker-compose.yml` dosyasının bulunduğu klasörde çalıştırın.

| İşlem | Komut |
|---|---|
| Durum | `docker compose ps` |
| Loglar | `docker compose logs -f app` |
| Durdurma (veriler korunur) | `docker compose down` |
| Yeniden başlatma | `docker compose up -d --wait` |
| Güncelleme | `docker compose pull && docker compose up -d --wait` |
| Veritabanı yedeği | `docker compose exec -T postgres pg_dump -U testops testops > testops.sql` |
| Ek dosya yedeği | `docker compose cp app:/data/attachments ./attachments-yedek` |
| Her şeyi silme (**veriler dahil**) | `docker compose down -v` |

Güncellemede veritabanı migration'ları uygulama açılırken otomatik uygulanır. Belirli bir sürümde kalmak için `.env` dosyasına `APP_IMAGE=ghcr.io/caslanqa/testops:0.2.0` ekleyin. Yayınlanan etiketler: `latest`, `X.Y.Z`, `X.Y` ve `sha-<commit>`. Sürümler ve değişiklikler [Releases](https://github.com/caslanqa/test-ops/releases) sayfasında listelenir.

## Yapılandırma

Ayarlar `.env` dosyasından okunur; değiştirdikten sonra `docker compose up -d --wait` ile uygulayın. Tüm değişkenlerin açıklamalı listesi [`.env.example`](.env.example) dosyasındadır.

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `JWT_SECRET` | — (zorunlu) | Oturum token'larını imzalar. En az 32 karakter; `openssl rand -hex 32`. Değiştirilirse herkesin oturumu kapanır. |
| `POSTGRES_PASSWORD` | — (zorunlu) | Veritabanı parolası. Postgres bunu volume ilk oluşturulurken kaydeder. |
| `POSTGRES_USER`, `POSTGRES_DB` | `testops` | Veritabanı kullanıcısı ve adı. |
| `APP_PORT` | `8080` | Arayüzün host'ta açılacağı port. |
| `APP_IMAGE` | `ghcr.io/caslanqa/testops:latest` | Çalıştırılacak imaj; sürüm sabitlemek için kullanın. |
| `JWT_EXPIRES_IN` | `8h` | Oturum süresi. |
| `SELF_REGISTRATION` | `true` | `false` ise kullanıcıları yalnızca workspace admin'leri ekler. |
| `RATE_LIMIT_PER_MINUTE` | `600` | Kullanıcı (veya anonim IP) başına dakikalık istek limiti; `0` kapatır. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `10` | Giriş, kayıt ve parola değişikliği için hesap başına limit. |
| `AUTH_IP_RATE_LIMIT_PER_MINUTE` | `60` | Aynı IP'den tüm hesaplara yapılan kimlik denemesi limiti. |
| `TRUST_PROXY` | kapalı | Ters proxy arkasındaysanız `true` veya hop sayısı (ör. `1`); bkz. aşağısı. |
| `ATTACHMENT_MAX_FILE_SIZE_BYTES` | 32 MB | Tek ek dosya sınırı. |
| `ATTACHMENT_MAX_REQUEST_SIZE_BYTES` | 128 MB | Tek istekte toplam yükleme sınırı. |
| `ATTACHMENT_MAX_FILES_PER_REQUEST` | `20` | Tek istekteki dosya sayısı. |
| `ATTACHMENT_ALLOWED_EXTENSIONS` | görüntü, video, metin, pdf, arşiv | Virgülle ayrılmış uzantılar, ör. `png,jpg,log,zip`. |

### Ters proxy ve HTTPS

TestOps kendi başına HTTP sunar. İnternete açacaksanız önüne TLS sonlandıran bir ters proxy (nginx, Caddy, Traefik) koyun ve proxy'yi `http://localhost:8080` adresine yönlendirin. Bu durumda `.env` dosyasına `TRUST_PROXY=1` ekleyin. Aksi halde uygulama tüm istekleri proxy'nin IP'sinden gelmiş sayar ve kullanıcılar aynı rate limit sayacını paylaşır. Uygulama doğrudan internete açıksa `TRUST_PROXY`'yi boş bırakın; aksi halde istemciler `X-Forwarded-For` başlığını uydurarak limiti atlatabilir.

## Compose olmadan (`docker run`)

İmaj veritabanı içermez; önce PostgreSQL'i aynı Docker ağında başlatmanız gerekir. Uygulama container'ı içeride **3000** portunu dinler, bu yüzden port eşlemesi `-p <host-portu>:3000` şeklinde olmalıdır.

```bash
PGPW=$(openssl rand -hex 16)      # bu iki değeri saklayın; yeniden kurulumda aynısı gerekir
JWT=$(openssl rand -hex 32)

docker network create testops

docker run -d --name testops-db --network testops --restart unless-stopped \
  -e POSTGRES_USER=testops -e POSTGRES_PASSWORD="$PGPW" -e POSTGRES_DB=testops \
  -v testops-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine

docker run -d --name testops --network testops --restart unless-stopped \
  -e DATABASE_URL="postgresql://testops:$PGPW@testops-db:5432/testops?schema=public" \
  -e JWT_SECRET="$JWT" \
  -e ATTACHMENTS_DIR=/data/attachments -v testops-attachments:/data/attachments \
  -p 8080:3000 \
  ghcr.io/caslanqa/testops:latest
```

Uygulama, veritabanı bağlantı kabul edene kadar migration'ı yeniden dener. Hazır olduğunu `docker inspect -f '{{.State.Health.Status}}' testops` komutuyla (`healthy`) ya da `curl http://localhost:8080/ready` ile kontrol edebilirsiniz.

## Sorun giderme

Önce `docker compose logs app` (veya `docker logs testops`) çıktısına bakın.

| Belirti | Sebep ve çözüm |
|---|---|
| `TestOps: DATABASE_URL is not set` veya `Environment variable not found: DATABASE_URL` | İmaj veritabanı olmadan tek başına çalıştırılmış. [Hızlı başlangıç](#hızlı-başlangıç-önerilen) bölümündeki Compose kurulumunu kullanın ya da [Compose olmadan](#compose-olmadan-docker-run) bölümündeki gibi PostgreSQL'i de başlatıp `DATABASE_URL` verin. |
| `JWT_SECRET tanımlı değil` (compose) veya `JWT_SECRET is not set / is a placeholder / is too short` | `.env` dosyasına `JWT_SECRET=$(openssl rand -hex 32)` ile üretilmiş bir değer yazın. |
| Container `healthy` ama tarayıcıda sayfa açılmıyor | Port eşlemesi yanlış: container 3000'i dinler. `-p 8080:3000` kullanın (`-p 8080:8080` değil). |
| `port is already allocated` / `address already in use` | 8080 başka bir uygulamada. `.env` dosyasına ör. `APP_PORT=9090` yazıp http://localhost:9090 adresini kullanın. |
| `P1000: Authentication failed against database server` | `POSTGRES_PASSWORD` ilk kurulumdan sonra değiştirilmiş; Postgres eski parolayı kullanmaya devam eder. Eski parolaya dönün. Verileri silmeyi göze alıyorsanız `docker compose down -v` sonrası yeniden başlatın. |
| `pull access denied for testops` | `.env` içinde eski `APP_IMAGE=testops:local` satırı kalmış; o satırı silin. |
| `docker: invalid reference format` veya `--name: command not found` | Çok satırlı komutta `\` satırın son karakteri olmalı; arkasında boşluk kalırsa komut bölünür. |
| Girişte `Too many attempts. Try again in N seconds.` | Kısa sürede çok fazla deneme yapıldı; belirtilen süre kadar bekleyin. Limitler yukarıdaki tabloda. |

Sağlık uç noktaları: `/health` (process ayakta mı) ve `/ready` (veritabanı erişilebilir mi). API dokümantasyonu `/api/docs` adresindedir.

## Geliştirme

Kaynak koddan çalıştırmak için Node 20+, pnpm (sürümü `package.json` içindeki `packageManager` alanında) ve Docker gerekir.

```bash
git clone https://github.com/caslanqa/test-ops.git && cd test-ops
pnpm install
pnpm start        # .env'i hazırlar, imajı kaynaktan build eder, demo veriyi yükler ve tarayıcıyı açar
pnpm test:smoke   # çalışan stack'e karşı smoke testleri
```

Repo içindeki `docker compose` komutları `docker-compose.override.yml` dosyasını da otomatik yükler. Bu dosya imajı registry yerine çalışma kopyasından build eder (`testops:local`) ve PostgreSQL'i `127.0.0.1:5432` üzerinden host'a açar. Kurulum için yalnızca `docker-compose.yml` gerekir.

- Monorepo: `apps/api` (NestJS + Prisma), `apps/web` (React + Vite). Tasarım: [`design-doc.md`](design-doc.md), yol haritası: [`PLAN.md`](PLAN.md).
- `master`'a merge edilen her değişiklik CI'dan geçtikten sonra otomatik olarak sürümlenir; imaj GHCR'ye gönderilir, git tag'i ve GitHub Release oluşturulur. Sürüm commit mesajından belirlenir: `feat:` minor, `fix:` ve diğerleri patch, `feat!:` veya `BREAKING CHANGE:` major artırır.
