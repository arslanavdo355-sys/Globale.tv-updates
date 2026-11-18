# Globale.tv — webOS (LG Smart TV)

Bu klasör, Globale.tv'nin LG webOS sürümünün kaynak kodudur. Aynı dosyalar hem
tarayıcıdan test için (bu sayfa) hem de ileride gerçek LG televizyona
yüklenecek `.ipk` paketi için kullanılır — webOS uygulamaları zaten HTML5/CSS/JS
tabanlıdır, bu yüzden ek bir "mobil/TV ayrımı" yoktur.

## Test (şu an)

Canlı test linki: https://arslanavdo355-sys.github.io/Globale.tv-updates/webos/

Telefon/tablet/bilgisayar tarayıcısından açılır. Sağ altta beliren 🎮 ikonu
sanal kumandayı açar; klavye ok tuşları + Enter de çalışır.

## Durum

- [x] 16:9 TV ekranı + sanal kumanda + klavye/dokunmatik kontrol
- [x] Cihaz Kimliği (gerçek MAC yerine kalıcı Device ID — webOS gerçek MAC
      vermiyorsa sahte MAC asla üretilmez)
- [x] Panel bağlantısı (MAC/Device ID + PIN + QR) — Android uygulamasıyla
      birebir aynı API (`/api/tv/hello`, `/api/tv/sources`)
- [x] Kanal/kaynak listesi + HLS oynatıcı (temel)
- [x] Ayarlar menüsü iskeleti (Genel, Görüntü, Ses, Oynatıcı, Dil, QR Kumanda,
      Kanal Yönetimi, Yedekleme, Hakkında)
- [ ] Tüm 20 dil (şu an sadece arayüz iskeleti tek dilde; çoklu dil ayrı iş)
- [ ] Aktivasyon + ödeme sistemi (PayPal/kart/Apple Pay/Google Pay) — ayrı bir
      sunucu/arka uç gerektirir, henüz yok
- [ ] Yönetim paneli (kullanıcı/ödeme/istatistik)
- [ ] Yasal sayfalar (Impressum, Datenschutz, AGB, Widerrufsbelehrung) — gerçek
      şirket/vergi bilgisi gerekiyor, placeholder ile yayınlanmayacak
- [ ] LG Content Store paketleme (`.ipk`, webOS CLI/SDK ile; appinfo.json
      burada hazır, paketleme adımı ayrı)
- [ ] EPG/XMLTV, altyazı/ses dili seçimi, kanal arama, favoriler, kanal
      numaraları/logoları — temel oynatım üstüne eklenecek sonraki katman

## Not

Yeni, ayrı bir GitHub reposu ("Globale.tv-webOS") açılması istendi, ancak bu
oturumun GitHub erişimi önceden tanımlı repolarla sınırlı olduğu için yeni repo
açılamadı. Kod şimdilik `Globale.tv-updates/docs/webos/` altında duruyor
(zaten herkese açık sitenin bir parçası, gizli bilgi içermiyor). İstenirse
gerçek bir "Globale.tv-webOS" reposu kullanıcı tarafından açılıp kod oraya
taşınabilir.
