# Albion Trade Intelligence

Albion Online için **gerçek piyasa verileriyle** çalışan bir ticaret karar destek paneli. Market flipping ve kraliyet şehirleri arası ticaret fırsatlarını; vergiler, likidite, veri güncelliği ve sermaye kısıtlarıyla birlikte değerlendirir.

> Bu bir karar destek aracıdır, oyun içi bot değildir. Oyun istemcisine müdahale etmez. Gösterilen kârlar tahminidir ve garanti değildir.

## Kurulum

Gereksinimler: Node.js ≥ 20.9 (Node 25 ile test edildi), npm.

```bash
npm install
npm run dev          # http://localhost:3000
```

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Üretim derlemesi / sunucusu |
| `npm test` | Vitest birim testleri |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript (strict) |
| `npm run catalog` | Item kataloğunu ao-bin-dumps'tan yeniden üretir (`src/data/catalog.json`) |
| `npm run avalon` | Avalon Yolları bölge verisini ao-bin-dumps'tan yeniden üretir (`src/data/avalon.json`) |
| `npm run zones` | Bölge adlarını (damage meter run'ları için) ao-bin-dumps'tan yeniden üretir (`src/data/zones.json`) |
| `npm run damage:simulate -- <url>` | Damage meter boru hattını oyun olmadan, **sentetik** paketlerle dener (gerçek veri değildir) |
| `npm run smoke` | Gerçek API'ye karşı uçtan uca tarama (konsola özet basar) |

Veritabanı, kimlik doğrulama veya ortam değişkeni gerekmez. Kullanıcı ayarları tarayıcının `localStorage`'ında tutulur.

## Teknoloji

Next.js 16 (App Router, Cache Components), React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui (Base UI), Lucide, TanStack Table v9, TanStack Query v5, Zod v4, Recharts, Vitest.

## Veri kaynakları

| Kaynak | Kullanım |
| --- | --- |
| [Albion Online Data Project](https://www.albion-online-data.com/) — `https://europe.albion-online-data.com` (ayrıca `west`, `east`) | Güncel fiyatlar, geçmiş, emir defteri |
| `GET /api/v2/stats/prices/{ids}.json?locations=` | Şehir × kalite başına en düşük satış / en yüksek alış emri ve görülme zamanları |
| `GET /api/v2/stats/history/{ids}.json?time-scale=24&date=` | Günlük `item_count` (hacim) ve `avg_price` — likidite, oynaklık, anomali tespiti |
| `GET /api/v2/stats/orderbook/{ids}.json` | Fiyat seviyesi başına emir miktarı — anında işlemlerde derinlik kontrolü |
| [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps) `formatted/items.json` + `items.json` | Item ID ↔ isim (TR/EN), tier, enchant, kategori, ağırlık, maksimum kalite |
| ao-bin-dumps `cluster/world.xml`, `cluster/TNL-*.cluster.xml`, `templates/NONE/*.template.xml` | Avalon Yolları: bölge adı/tipi/tier'ı, sandık doğma noktaları, zindan girişleri, kaynak dağılımı |
| `https://render.albiononline.com/v1/item/{id}.png` | Item ikonları |

Endpoint'ler, parametreler ve yanıt formatları uygulamadan önce gerçek isteklerle ve `/api/v2/swagger_doc` üzerinden doğrulandı.

## Mimari

```
scripts/build-catalog.ts      ao-bin-dumps → src/data/catalog.json (repo'da, runtime'da GitHub'a istek yok)
scripts/build-avalon.ts       ao-bin-dumps → src/data/avalon.json (Avalon Yolları bölge yapıları)
src/lib/albion/               API katmanı: sabitler, Zod şemaları, batching, rate limiter, TTL cache, HTTP client
src/lib/catalog/              Katalog erişimi + tarama evreni (universe.ts)
src/lib/market/               Normalizasyon, hacim/oynaklık istatistikleri, emir defteri derinliği, sunucu servisi (service.ts)
src/lib/profit/               Kâr motoru (4 senaryo) + ücret varsayımları
src/lib/scanner/              Flipping ve şehirler arası tarayıcılar
src/lib/scoring/              Çok kriterli skor, güven ve risk seviyesi
src/lib/optimizer/            Bütçe sepeti
src/lib/avalon/               Avalon XML ayrıştırıcıları (parse.ts) + arama/filtre (query.ts)
src/lib/damage/               Photon (Protocol18) çözücü, kalibrasyon, hasar sayacı, sunucu servisi (damage meter)
tools/albion-capture/         Windows paket yakalayıcı (tek dosya C#, Windows'un kendi derleyicisiyle derlenir)
src/lib/opportunities.ts      Sunucu orkestrasyonu: snapshot → tarama → emir defteri → sepet
src/app/api/*                 Route handler'lar (opportunities, items/[id], catalog/search, status)
src/app/*, src/components/*   UI (tamamı client'tan yalnızca kendi API'mize istek atar)
```

- **İstemci asla Albion API'sine doğrudan istek atmaz.** Tarama sunucuda yapılır, istemciye yalnızca filtrelenmiş fırsatlar döner.
- Hesaplama modülleri (`profit`, `scanner`, `scoring`, `optimizer`) saf fonksiyonlardır ve birim testlidir.

## Rate limit ve cache stratejisi

API kuralları (swagger'dan): **100 istek/dk ve 300 istek/5 dk** (IP başına), URL ≤ 4096 karakter, **sıkıştırma zorunlu** (gzip'siz istekler 1 istek/5 dk ile sınırlanır), 429'da `RateLimit-Reset` beklenmeli (yok sayan istemcilere 5 dk firewall ban).

- Tüm istekler `Accept-Encoding: gzip, deflate, br` ile tek bir süreç-geneli **sliding-window limiter** üzerinden gider (90/dk, 270/5 dk, en fazla 3 eşzamanlı).
- Item ID'leri URL ≤ 3900 karakter olacak şekilde **batch**'lenir (~165 item/istek). Varsayılan evren 5.732 item → 35 fiyat + 35 hacim isteği.
- **429**: limiter `RateLimit-Reset` zamanına kadar tüm istekleri durdurur; bekleme ≤ 15 sn ise bir kez yeniden dener, aksi halde kullanıcıya geri sayımlı hata gösterilir. İstemci tarafı Query, 429 ve 4xx hatalarında otomatik tekrar denemez.
- **Cache** (bellek içi, stale-while-revalidate, eşzamanlı istek tekilleştirme): fiyatlar 5 dk, hacim 60 dk, emir defteri 2 dk, ürün detayı 3 dk. Yenileme yalnızca uygulama kullanılırken tetiklenir; arka planda polling yoktur.
- Kısmi hata: bazı paketler başarısız olursa kalanlarla devam edilir ve arayüzde `x/y paket` olarak gösterilir. Yenileme başarısız olursa eski veri uyarıyla sunulur.

## Hesaplama modeli

### Fiyat seçimi
Yalnızca **en düşük satış emri** (`sell_price_min`) ve **en yüksek alış emri** (`buy_price_max`) kullanılır; `buy_price_min`/`sell_price_max` troll emirlerle doludur. `0` fiyat veya `0001-01-01` tarihi "veri yok" sayılır. Eşleşme her zaman **item ID (enchant dahil) + kalite** üzerinden birebirdir.

| Senaryo | Alış fiyatı | Satış fiyatı | Ücretler |
| --- | --- | --- | --- |
| Anında Al → Satış Emri | kaynak en düşük satış | hedef en düşük satış − 1 | satış kurulum + relist + vergi |
| Alış Emri → Satış Emri | kaynak en yüksek alış + 1 | hedef en düşük satış − 1 | alış kurulum + satış kurulum + relist + vergi |
| Alış Emri → Anında Sat | kaynak en yüksek alış + 1 | hedef en yüksek alış | alış kurulum + vergi |
| Anında Al → Anında Sat | kaynak en düşük satış | hedef en yüksek alış | vergi |

Market flipping = aynı şehirde *Alış Emri → Satış Emri*. Her fırsat için başabaş satış fiyatı hesaplanır; zarar eden fırsatlar varsayılan olarak gizlenir.

### Vergi varsayımları (doğrulanamadı)
Resmi bir 2026 kaynağı bulunamadı; topluluk kaynaklarına dayanan varsayılanlar **Ayarlar** sayfasından değiştirilebilir:

- Emir kurulum ücreti: **%2,5** (alış ve satış emri, iade edilmez)
- Satış vergisi: **%4 Premium / %8 Premium yok** (satış emri dolduğunda ve anında satışta)
- Anında alım: ücret yok
- Yeniden listeleme: satış emri başına varsayılan **1** kez, her biri kurulum ücretini yeniden öder
- Taşıma maliyeti (silver/kg) ve kapasite: API'de yok, isteğe bağlı kullanıcı girdisi

Oyun içi market penceresinden kontrol edin.

### Skor, güven ve risk
Skor (0–100) şunların ağırlıklı toplamıdır: potansiyel net kâr (log ölçekli), ROI (%40'ta doyar, %150 üstü cezalı), likidite (gözlemlenen günlük hacim), güncellik, fiyat oynaklığı, sermaye kilitlenme süresi. Ek kurallar:

- Hacim verisi yoksa skor en fazla 40, güven **Düşük**, önerilen adet en fazla 10.
- Kullanılan fiyat 7 günlük ortalamanın %40'ının altında / 2 katının üstündeyse **Anomali**; ROI > %150 ise **Aşırı ROI** → skor yarıya iner, sepete alınmaz.
- Veri yaşı sınırını aşan fiyatlar **güncel fırsat olarak gösterilmez** (isteğe bağlı "Eski veriyi göster").

### Önerilen adet ve bütçe optimizer
- Adet = min(risk bazlı bütçe payı, günlük hacmin %10–25'i × 2–5 gün (risk tercihine göre, emir tarafları arasında bölünür), taşıma kapasitesi, maks. yatırım filtresi).
- Anında işlem adayları için emir defterinde fiyatın %3 yakınındaki derinlik kontrol edilir. Daha yeni bir fiyat gözleminden önce görülmüş seviyeler (muhtemelen dolmuş) sayılmaz.
- Optimizer skor sırasıyla açgözlü dağıtır: ürün başına tek pozisyon, en fazla 12 pozisyon, pozisyon başına bütçe tavanı (Dengeli: düşük risk %25, orta %15, yüksek %8, hacimsiz %4). Tüm ücretler sermayeye dahildir. Toplam yatırım, tahmini kâr, kullanılmayan bütçe ve dokunulmayan sermaye gösterilir.
- **Günlük kazanç tahmini üretilmez.**

## Avalon Yolları

`/avalon` sayfası bölge adıyla arama yapar ve her bölgenin sabit yapısını gösterir. Market verisinden bağımsızdır; Albion Data API'ye istek atmaz.

- **Bölgeler:** `world.xml` içindeki etkin `TNL-*` kümeleri (400 bölge). Tier, küme dosya adından okunur (`..._T6_...`).
- **Sandıklar:** Bölge dosyasındaki her şablon örneğinin *aktif katmanlarındaki* `SpawnPoint_LOOTCHEST_*_AVALON_ROAD_*` noktaları sayılır; boyut (küçük/orta), sınıf (standart/veteran/elit) ve tier ayrıştırılır.
- **Zindanlar:** Aktif `DNG_(Solo|Group|Raid)_T#_<fraksiyon>` katmanları. Betik bu sayıyı bölgenin minimap zindan işaretleriyle karşılaştırır; uyuşmazlık %5'i aşarsa hata verir (dump formatı değişmiş demektir).
- **Kaynaklar:** `world.xml` dağıtım tablosu; tier < 4 satırlar editör yer tutucusu olduğundan atılır.
- **Gösterilmeyenler:** Sandık rengi (yeşil/mavi/altın) doğuşta sunucu tarafından belirlenir; bölgeler arası portal bağlantıları dinamiktir. İkisi de oyun dosyalarında yoktur ve oyun trafiğini dinlemeden öğrenilemez — bu uygulama bunu yapmaz.

## Damage Meter

`/damage` sayfası grubun verdiği hasarı, iyileştirmeyi ve aldığı hasarı oturum bazında gösterir. Hiçbir açık API'de hasar verisi yoktur (killboard yalnızca PvP ölümlerini içerir); tek kaynak oyun istemcisine gelen ağ trafiğidir.

**Akış:** `tools/albion-capture/AlbionCapture.cs` (Windows, oyunun çalıştığı bilgisayar) → `POST /api/damage/ingest` → Photon çözücü (`src/lib/damage/photon.ts`, `protocol18.ts`; paket başlıkları big-endian, mesaj içeriği Protocol18: little-endian + zigzag varint) → hasar sayacı (`meter.ts`) → `/damage` sayfası (1 sn'de bir yenilenir).

**Yakalayıcı** yalnızca oyun sunucusundan *gelen* UDP 5056 paketlerini Windows ham soketiyle (SIO_RCVALL) okur ve ham içeriği bu uygulamaya iletir. Oyuna paket göndermez, paket değiştirmez/engellemez, oyun sürecine veya dosyalarına dokunmaz. Npcap gerekmez; yönetici izni gerekir. Derleme (indirme gerektirmez):

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:AlbionCapture.exe AlbionCapture.cs
.\AlbionCapture.exe http://<uygulama-ip>:3100   # PowerShell'de baştaki .\ gerekli
```

**Otomatik kalibrasyon (varsayılan):** Oyun yamaları olay numaralarını değiştirebildiğinden kodlar sabit yazılmaz. `auto-calibrator.ts` son 3 dakikanın çözülmüş mesajlarını tutar ve `calibrate.ts` ile analiz eder:
- *Kimlik kuralları:* karakter adına benzeyen bir string (3–16 harf/rakam) ile **long** tipinde bir nesne kimliğini birlikte taşıyan mesajlar. Gerçek trafikte kimlikler hep compressed long olarak gelir; aynı mesajdaki int/byte sayaçlar böylece elenir. Her mesaj tipinden tek kural seçilir: kimliği en çok vuruşta görülen anahtar, isim olarak da kimliğe göre benzersiz olan anahtar (lonca adı birden çok oyuncuda tekrarlanır).
- *Can değişimi kuralı:* bu kimliklerden birini vuran olarak ve bir ondalık değeri taşıyan olay. Sıralama, anahtar 0'daki öznenin oyuncu değil mob olmasına göre yapılır; enerji/mana gibi benzer olaylar böylece geriye düşer.
- Ayar yalnızca kanıt netse uygulanır (en az 15 mob vuruşu ve ikinci adayın en az iki katı). Uygulanınca tampondaki trafik yeniden işlenir; kalibrasyondan önceki vuruşlar kaybolmaz. Mevcut ayar vuruş eşleştirmeye devam ettiği sürece korunur, eşleşme kesilirse (yama) kendiliğinden yenilenir. Doğrulandığı hali (Europe, Kasım 2026): `event:6`, vuran anahtar 6, değişim 2, hedef 0; kendi karakterin `response:2` anahtar 2.
- Elle kalibrasyon (kayıt al → adayları seç) "Gelişmiş" altında durur.

**Otomatik oturum:** İlk oyuncu vuruşunda veya kendi Fame ödülünde başlar; ayarlanan süre (varsayılan 5 dk) boyunca oyuncu vuruşu/Healing/kendi Fame ödülü olmazsa son etkinlik anında kapanıp kaydedilir. Fame ödülü içermeyen 10 vuruştan kısa otomatik oturumlar atılır. Zamanlar yakalayıcının (Windows) saatine göredir. Ayarlar `.data/damage/settings.json` dosyasındadır.

**Sayım kuralları:** negatif değişim + oyuncu neden → verilen hasar; pozitif değişim + oyuncu neden → iyileştirme (kendine iyileştirme hariç; fazla iyileştirme dahil olabilir); hedef oyuncuysa → alınan hasar. Sahibi eşleşmeyen hasar (pet, ismi yakalanmadan bölgeye girmiş oyuncu) "eşleşmeyen" olarak ayrı tutulur. Nesne kimlikleri bölge değişiminde yenilendiği için kimlik eşlemesi sürekli güncellenir.

**Main Hand:** Oyuncu satırında son görülen Main Hand ikonu, İngilizce item adı ve Tier/Enchantment gösterilir; ekipman değişimi geldiğinde güncellenir ve oturumla kaydedilir. Bu alan Damage toplamını silahlar arasında bölmez. Ekipman paketi henüz gelmediyse veya item index eşleşmiyorsa "Bilinmiyor", slot boşsa "Unarmed" görünür. Eski oturumlar ekipman bilgisi olmadan açılabilir. Ekipman düzeni mevcut paket kayıtlarıyla doğrulanmıştır (`NewCharacter` key 40, `CharacterEquipmentChanged` event 90/key 2, Main Hand slot 0); oyun yamalarında event kodu ve catalog index eşlemesi tekrar kontrol edilmelidir (`npm run catalog`).

**Personal Fame:** Yalnızca yerel Join cevabından tanınan karakterin `UpdateFame` ödülleri sayılır. Oturumda Total Fame, Fame/hour, Fame (zone incl.), Premium bonus ve Satchel bonus toplamları kaydedilir. Mevcut düzen: event 82, karakter id key 0, lifetime counter key 1, zone dahil ödül key 2, Premium flag key 5, Satchel key 10, son bonus oranı key 17; fixed-point alanlar 10.000'e bölünür. Premium katkısı zone dahil ödülün %50'sidir; son bonus oranı ödüle zaten dahildir ve tekrar çarpılmaz. Buff adı/süresi bu kayıtta yoktur; oran gelmediyse "Bilinmiyor" gösterilir. Crafting array'leri sayılmaz. Artmayan lifetime counter değerleri yeniden gönderim/kalibrasyon tekrarı olarak atılır; kaçırılan ödüller lifetime farkından doldurulmaz. Fame takibi Damage kalibrasyonundan bağımsızdır; kendi karakterinin tanınması için yakalayıcı açıkken bölge değişimi gerekebilir. Eski oturumlarda Fame alanı bulunmayabilir. Düzen, [UpdateFame okuyucusu](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/Network/Events/UpdateFameEvent.cs) ve mevcut Premium/Satchel içermeyen yerel paketlerle kontrol edildi; bonus kombinasyonları sentetik paket testleriyle doğrulandı, gerçek Premium/buff kaydıyla oyun testi bekleniyor.

**Veri:** Oturumlar `.data/damage/sessions/*.json`, ayar `config.json` / `settings.json`, kalibrasyon kayıtları `.data/damage/captures/*.jsonl` (hepsi gitignore'da). Hiçbir veri dışarı gönderilmez.

**Sınırlar ve riskler:**
- Yakalayıcının çalıştığı istemcinin gördüğü kadar: görüş menzili dışındaki grup üyelerinin vuruşları eksik kalabilir.
- Şifreli Photon mesajları çözülemez ve sayılır ("Çözülemeyen").
- VPN/ExitLag gibi araçlar trafiği farklı bir arayüzden geçirebilir; yakalayıcı tüm IPv4 arayüzlerini dinler ama garanti edilemez.
- `/api/damage/ingest` yerel ağa açıktır ve kimlik doğrulaması yoktur; uygulamayı güvenilir ağda çalıştırın.
- Sandbox Interactive'in yalnızca okuyan araçlara göz yumduğu bilinse de resmi bir garanti yoktur; kullanım riski kullanıcıya aittir.
- C# yakalayıcı macOS'ta derlenemez; Windows'ta (yerleşik `csc.exe`) derlenip gerçek oyunla denendi.
- Parti üyeleri otomatik algılanmaz; tabloda bölgede vuran tüm oyuncular görünür, isteğe bağlı isim filtresi vardır.

## Masaüstü uygulaması (Windows)

Tek pencerelik Windows uygulaması: market, Avalon ve damage meter aynı yerde, terminal yok. Damage Meter'daki **Başlat** düğmesi paket yakalayıcıyı arka planda çalıştırır (Windows bir kez yönetici izni sorar); **Durdur** ya da uygulamayı kapatmak onu durdurur.

**Kurulum dosyası üretmek (Windows PC'de, GitHub gerekmez):**
1. [nodejs.org](https://nodejs.org/) adresinden **LTS** sürümünü kur.
2. Bu depoyu ZIP olarak indirip bir klasöre çıkar.
3. `build-windows.cmd` dosyasına çift tıkla. Bitince `dist-electron\AlbionTradeIntelligence-Setup-<sürüm>.exe` açılır.

**GitHub Actions:** `.github/workflows/desktop.yml` aynı adımları GitHub'ın Windows makinesinde çalıştırır. Elle "Run workflow" kurulum dosyasını indirilebilir artifact olarak verir; `v*` etiketi ise sürümü yayınlar (aşağıya bak). Hesapta fatura kilidi varsa GitHub iş akışını başlatmaz.

**Paylaşma:** İndirme linki tektir: <https://github.com/ugurc4n/albion-trade-intelligence/releases/latest>. Kurulum tek tıklıktır ve yönetici izni istemez. Uygulama imzasız olduğundan Windows ilk açılışta "Bilgisayarınızı korudu" uyarısı gösterir: *Ek bilgi → Yine de çalıştır*.

### Otomatik güncelleme

Kurulu uygulama açıldıktan ~10 sn sonra ve sonra 4 saatte bir yeni sürüm var mı diye bakar, varsa arka planda indirir. İndirme bitince kenar çubuğunda **Restart to update** çıkar; kullanıcı basmazsa güncelleme uygulama kapanırken sessizce kurulur. Kurmadan önce uygulama sunucusunu durdurur ve yakalayıcının (`AlbionCapture.exe`) kapanmasını bekler, yoksa dosyası kilitli kalır. Ayrıntılar: `electron/updater.js`, kayıt: `%APPDATA%\Albion Trade Intelligence\updater.log`.

Sürümler kaynak koddan **ayrı, herkese açık** `ugurc4n/albion-trade-intelligence` deposunda yayınlanır (`electron-builder.yml` → `publish`). Bu adres her kurulum dosyasının içine yazılır; böylece bu kaynak depo ileride private olsa da kullanıcılar güncelleme almaya devam eder. Adresi değiştirmek, eski kurulumları eski adreste bırakır.

**Bir kerelik kurulum:**
1. GitHub'da **public** `albion-trade-intelligence` deposunu oluştur ve README ile başlat (boş depoda sürüm etiketi açılamaz). Bu isim, bu deponun eski adıdır; GitHub şu an onu buraya yönlendiriyor, yeni depo açınca yönlendirme kalkar.
2. Bir *fine-grained personal access token* oluştur: yalnızca o depo, **Contents: Read and write**.
3. Bu depoda *Settings → Secrets and variables → Actions* altına `RELEASES_TOKEN` adıyla ekle.

**Sürüm çıkarmak:**
1. `package.json` içindeki `version`'ı artır (ör. `0.5.0`), commit'le ve push'la.
2. `git tag v0.5.0 && git push origin v0.5.0`. İş akışı etiketin `package.json` ile aynı olduğunu kontrol eder, paketler ve kurulum dosyasını, `.blockmap`'i ve `latest.yml`'ı sürüm notlarıyla (`scripts/release-notes.mjs`: önceki etiketten bu yana commit başlıkları) releases deposuna yükler.

GitHub Actions çalışmıyorsa aynı şeyi kendi bilgisayarından yapabilirsin: `build-windows.cmd`'nin adımlarını (`npm ci`, yakalayıcı, `npm run build:desktop`) çalıştırdıktan sonra `$env:GH_TOKEN = "<token>"; npm run release:win`.

Sürüm yayınlanınca geri alınmaz gibi düşün: kullanıcılar birkaç saat içinde indirir. Bozuk bir sürümü düzeltmenin yolu, sürüm numarasını artırıp yenisini çıkarmaktır.

**Nasıl çalışır:** `electron/main.js`, Next.js'in standalone sunucusunu (`npm run build:desktop` → `.next-electron/standalone`) boş bir loopback portunda Electron utility process olarak başlatıp pencerede gösterir. Kullanıcı verisi `%APPDATA%\Albion Trade Intelligence\data` altındadır (`ATI_DATA_DIR`). Yakalayıcı `/target:winexe` ile konsolsuz derlenir ve `--parent <pid>` ile çağrılır; her ~2 sn'de bir boş paketle "kalp atışı" gönderir, uygulama "dur" dediğinde, sunucu süreci kapandığında ya da 20 sn ulaşılamadığında kendini kapatır.

## Sınırlamalar

- Veriler, Albion Data Client çalıştıran oyuncuların gördüğü kadardır: kapsama eksik, gecikmeli ve şehre göre değişken olabilir. History `item_count` gerçek hacmin alt sınırıdır.
- Emir defteri endpoint'i eski seviyeleri bir süre tutabilir; uygulama bunları daha yeni fiyat gözlemleriyle karşılaştırarak eler ama tam doğruluk garanti edilemez.
- Vergi/ücret oranları ve relist sayısı varsayımdır. Taşıma süresi ve riski API'de yoktur.
- Tarama evreni (`src/lib/catalog/universe.ts`): T4–T8 kaynaklar ve işlenmiş kaynaklar, ekipman/çanta/pelerin (enchant ≤ 3), iksir ve yemekler, temel binekler. Artefaktlar ve T1–T3 hariçtir. Diğer ürünler detay sayfasında görüntülenebilir ancak otomatik taranmaz.
- Caerleon, Brecilien ve Black Market güvenli rota hesaplarına dahil değildir.
- Cache süreç belleğindedir; çoklu sunucu (serverless/çok instance) dağıtımında her instance kendi limit sayacını tutar. Tek süreçli kullanım için tasarlanmıştır.

## Test

```bash
npm test
```

Kapsam: kâr motoru (4 senaryo, Premium/Premium yok, başabaş, relist, taşıma), normalizasyon (boş/sentinel tarih, UTC, şehir eşleme, troll emir), hacim istatistikleri, batching (URL limiti), HTTP client (gzip başlığı, 429 bekle-tekrar dene ve duraklatma, HTTP/JSON hataları), rate limiter, cache (SWR, hata davranışı), tarayıcılar (kalite/enchant eşleşmesi, eski veri, eksik taraf, hacimsiz ürün, anomali, kapasite/yatırım limitleri), skor (yüksek ROI'li illikit ürün < likit ürün), optimizer (çeşitlendirme, ücretler, derinlik limiti), emir defteri derinliği.
