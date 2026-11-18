/* Globale.tv — webOS test uygulaması
 * Panel API sözleşmesi, Android uygulamasındaki GlobalePanelClient.kt ile BİREBİR aynıdır:
 *   BASE + /api/tv/hello   POST  { mac, secret, rotate? }  -> { mac, pin, pinExpiresAt, panelUrl }
 *   BASE + /api/tv/sources GET                              -> { sources: [...] }
 * Her istekte header: x-device-mac, x-device-secret
 *
 * Gerçek MAC adresi webOS'tan alınamıyorsa (bu tarayıcı-test ortamında hiçbir zaman alınamaz),
 * SAHTE bir MAC uydurulmaz — bunun yerine localStorage'da kalıcı bir "Device ID" üretilir
 * ve panel API'sine "mac" alanı olarak o gönderilir. Gerçek webOS cihazında (ileride) burası
 * connectionmanager luna servisinden gerçek MAC okuyacak şekilde genişletilecek.
 */

const PANEL_BASE   = "https://globale-hesabim-tv.netlify.app";
const PANEL_DISPLAY = "is.gd/gtvpanel";
const LS_DEVICE_ID = "globale_webos_device_id";
const LS_SECRET    = "globale_webos_secret";
const LS_GROUPS_HIDDEN = "globale_webos_hidden_groups";

// ---------------- Cihaz kimliği ----------------
function uuidLike(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8);
    return v.toString(16);
  });
}
function getDeviceId(){
  let id = localStorage.getItem(LS_DEVICE_ID);
  if(!id){
    id = 'WEBOS-' + uuidLike().toUpperCase().replace(/-/g,'').slice(0,12);
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}
function getSecret(){
  let s = localStorage.getItem(LS_SECRET);
  if(!s){
    s = uuidLike().replace(/-/g,'') + uuidLike().replace(/-/g,'');
    localStorage.setItem(LS_SECRET, s);
  }
  return s;
}

// ---------------- Panel API ----------------
const Panel = {
  async _call(path, method, body){
    const headers = {
      'x-device-mac': getDeviceId(),
      'x-device-secret': getSecret(),
    };
    let opts = { method, headers };
    if(body){ headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(PANEL_BASE + path, opts);
    const text = await res.text().catch(()=> '');
    let json = null;
    try{ json = text ? JSON.parse(text) : null; }catch(e){}
    return { ok: res.ok, status: res.status, json };
  },
  async hello(rotate){
    const body = { mac: getDeviceId(), secret: getSecret() };
    if(rotate) body.rotate = true;
    const r = await this._call('/api/tv/hello', 'POST', body);
    return r.ok ? r.json : null;
  },
  async sources(){
    const r = await this._call('/api/tv/sources', 'GET');
    return r.ok && r.json ? (r.json.sources || []) : null;
  },
};

// ---------------- Ekran yönetimi ----------------
const Screens = {
  current: null,
  show(id){
    document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active'));
    const el = document.getElementById('screen-' + id);
    if(el) el.classList.add('active');
    this.current = id;
    Focus.onScreenChange(id);
  }
};

// ---------------- Basit D-pad odak yönetimi ----------------
const Focus = {
  stack: {}, // screenId -> { items: [el...], index }
  onScreenChange(id){
    this.refresh(id);
  },
  refresh(id){
    const screenEl = document.getElementById('screen-' + id);
    if(!screenEl) return;
    const items = Array.from(screenEl.querySelectorAll('.focusable, .group-item, .channel-item, .s-item'))
      .filter(el => el.offsetParent !== null);
    this.stack[id] = { items, index: 0 };
    this.apply(id);
  },
  apply(id){
    const st = this.stack[id]; if(!st || !st.items.length) return;
    st.items.forEach(el=>el.classList.remove('focused'));
    const el = st.items[st.index];
    if(el){ el.classList.add('focused'); el.scrollIntoView({block:'nearest'}); }
  },
  move(dir){
    const id = Screens.current;
    const st = this.stack[id]; if(!st || !st.items.length) return;
    // Basit model: liste tabanlı ekranlarda yukarı/aşağı sırada gezinir,
    // sol/sağ ile bölme (sidebar <-> liste) geçişi ChannelUI tarafından ayrıca yönetilir.
    if(dir === 'down') st.index = Math.min(st.items.length-1, st.index+1);
    if(dir === 'up') st.index = Math.max(0, st.index-1);
    this.apply(id);
  },
  activate(){
    const id = Screens.current;
    const st = this.stack[id]; if(!st || !st.items.length) return;
    const el = st.items[st.index];
    if(el) el.click();
  }
};

// ---------------- Panel bağlantı ekranı ----------------
const Connect = {
  timer: null,
  async start(){
    Screens.show('connect');
    document.getElementById('connectDeviceId').textContent = getDeviceId();
    document.getElementById('connectPanelAddr').textContent = PANEL_DISPLAY;
    await this.refresh(false);
  },
  async refresh(rotate){
    document.getElementById('connectStatus').textContent = 'Bağlanıyor…';
    const session = await Panel.hello(rotate);
    if(!session){
      document.getElementById('connectStatus').textContent = 'Panele ulaşılamadı — bağlantınızı kontrol edin.';
      return;
    }
    document.getElementById('connectPin').textContent = session.pin;
    this.renderQr(session.panelUrl || ('https://' + PANEL_DISPLAY));
    this.tick(session.pinExpiresAt);
    // Cihaz zaten eklenmiş kaynaklara sahipse direkt ana ekrana geç
    const sources = await Panel.sources();
    if(sources && sources.length){
      App.sources = sources;
      Screens.show('home');
      ChannelUI.render();
    }
  },
  renderQr(url){
    const box = document.getElementById('qrCanvas');
    box.innerHTML = '';
    if(window.QRCode){
      new QRCode(box, { text: url, width: 200, height: 200, colorDark:'#05080A', colorLight:'#ffffff' });
    }
  },
  tick(expiresAt){
    clearInterval(this.timer);
    const update = ()=>{
      const left = Math.max(0, Math.floor((expiresAt - Date.now())/1000));
      const m = String(Math.floor(left/60)).padStart(2,'0');
      const s = String(left%60).padStart(2,'0');
      document.getElementById('connectStatus').textContent = left > 0
        ? `PIN ${m}:${s} içinde yenilenecek`
        : 'PIN süresi doldu — yenileniyor…';
      if(left <= 0){ clearInterval(this.timer); this.refresh(true); }
    };
    update();
    this.timer = setInterval(update, 1000);
  }
};

// ---------------- Kanal / kaynak listesi ----------------
const ChannelUI = {
  groups: {},     // groupKey -> { name, channels: [] }
  activeGroup: null,
  activeChannel: null,
  buildGroups(){
    this.groups = {};
    (App.sources || []).forEach(src=>{
      const key = src.kind || 'diger';
      if(!this.groups[key]) this.groups[key] = { name: this.labelFor(src.kind), channels: [] };
      this.groups[key].channels.push(src);
    });
  },
  labelFor(kind){
    const map = { m3u:'M3U Listeleri', xtream:'Xtream Hesapları', url:'Bağlantılar' };
    return map[kind] || 'Diğer Kaynaklar';
  },
  render(){
    this.buildGroups();
    const keys = Object.keys(this.groups);
    if(!keys.length){ Screens.show('empty'); return; }
    const sidebar = document.getElementById('sidebarGroups');
    sidebar.innerHTML = '';
    keys.forEach((k,i)=>{
      const g = this.groups[k];
      const div = document.createElement('div');
      div.className = 'group-item focusable';
      div.innerHTML = `<span>${g.name}</span><span class="count">${g.channels.length}</span>`;
      div.onclick = ()=>{ this.activeGroup = k; this.renderChannels(); };
      sidebar.appendChild(div);
      if(i===0) this.activeGroup = k;
    });
    this.renderChannels();
    Screens.show('home');
  },
  renderChannels(){
    const list = document.getElementById('channelList');
    list.innerHTML = '';
    const g = this.groups[this.activeGroup];
    if(!g) return;
    g.channels.forEach((ch,i)=>{
      const div = document.createElement('div');
      div.className = 'channel-item focusable';
      div.innerHTML = `<span class="num">${i+1}</span><span class="logo">${(ch.name||'?').slice(0,2).toUpperCase()}</span><span class="name">${ch.name || ch.url}</span>`;
      div.onclick = ()=> Player.open(ch);
      div.onmouseenter = ()=> this.preview(ch);
      list.appendChild(div);
    });
    Focus.refresh('home');
  },
  preview(ch){
    document.getElementById('previewTitle').textContent = ch.name || '—';
    document.getElementById('previewSub').textContent = ch.kind === 'xtream' ? 'Xtream Codes kaynağı' : (ch.kind === 'm3u' ? 'M3U yayını' : (ch.url||''));
  }
};

// ---------------- Oynatıcı ----------------
const Player = {
  hls: null,
  open(ch){
    Screens.show('player');
    document.getElementById('playerName').textContent = ch.name || 'Kanal';
    document.getElementById('playerMeta').textContent = ch.kind === 'xtream' ? 'Xtream Codes' : (ch.url || '');
    const video = document.getElementById('videoEl');
    this.stop();
    const url = ch.url;
    if(!url){
      document.getElementById('playerMeta').textContent = 'Bu kaynak için oynatma adresi bulunamadı.';
      return;
    }
    if(Hls && Hls.isSupported() && /\.m3u8($|\?)/i.test(url)){
      this.hls = new Hls();
      this.hls.loadSource(url);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, ()=> video.play().catch(()=>{}));
      this.hls.on(Hls.Events.ERROR, (e, data)=>{
        if(data.fatal) document.getElementById('playerMeta').textContent = 'Yayın açılamadı (' + data.type + ')';
      });
    } else {
      video.src = url;
      video.play().catch(()=>{});
    }
    this.showOsd();
  },
  stop(){
    if(this.hls){ this.hls.destroy(); this.hls = null; }
    const video = document.getElementById('videoEl');
    video.pause(); video.removeAttribute('src'); video.load();
  },
  showOsd(){
    document.getElementById('playerOsd').classList.add('show');
    document.getElementById('playerTop').classList.add('show');
    clearTimeout(this._osdT);
    this._osdT = setTimeout(()=>{
      document.getElementById('playerOsd').classList.remove('show');
      document.getElementById('playerTop').classList.remove('show');
    }, 3500);
  },
  close(){
    this.stop();
    Screens.show('home');
  }
};

// ---------------- Ayarlar ----------------
const SETTINGS_SECTIONS = {
  general: { title:'Genel', rows:[
    { label:'Açılışta göster', desc:'Ana sayfa, son izlenen kanal veya seçili bir kanal', soon:true },
    { label:'Fabrika ayarlarına dön', desc:'Ayarlar sıfırlanır, kaynaklar ve favoriler silinmez', soon:true },
  ]},
  display:{ title:'Görüntü', rows:[
    { label:'Görüntü boyutu', desc:'Sığdır / Doldur / Uzat', soon:true },
    { label:'4K / HEVC yayınlar', desc:'Cihazın desteklediği en yüksek çözünürlük kullanılır', soon:true },
  ]},
  audio:{ title:'Ses ve Altyazılar', rows:[
    { label:'Ses dili', desc:'Yayında birden fazla ses izi varsa seçilir', soon:true },
    { label:'Altyazı dili', desc:'Yayında altyazı izi varsa seçilir', soon:true },
  ]},
  player:{ title:'Oynatıcı', rows:[
    { label:'Otomatik bağlantı yenileme', desc:'Yayın koptuğunda otomatik yeniden dener', soon:true },
    { label:'Son izlenen kanallar', desc:'Hızlı erişim için en son izlenenleri hatırla', soon:true },
  ]},
  lang:{ title:'Dil', rows:[
    { label:'Uygulama dili', desc:'Varsayılan: Almanca — şimdilik TR/DE/EN hazır, diğer 17 dil ekleniyor', soon:true },
  ]},
  qr:{ title:'QR Kumanda', rows:[
    { label:'Telefonla bağlan', desc:'Panel bağlantı ekranındaki QR kodu kullanın', soon:false, action:'connect' },
  ]},
  sources:{ title:'Kanal Yönetimi', rows:[
    { label:'Kaynakları yönet', desc:'Ekleme / düzenleme / silme web panelinden yapılır: ' + PANEL_DISPLAY, soon:false, action:'connect' },
  ]},
  backup:{ title:'Yedekleme ve Geri Yükleme', rows:[
    { label:'Ayarları dışa aktar', desc:'Yakında', soon:true },
  ]},
  about:{ title:'Uygulama ve Hakkında', rows:[
    { label:'Sürüm', desc:'Globale.tv webOS — test sürümü', soon:false },
    { label:'Cihaz Kimliği', desc:'', soon:false, dynamic:'deviceId' },
  ]},
};
const SettingsUI = {
  open(sec){
    Screens.show('settings');
    document.querySelectorAll('.s-item').forEach(el=>el.classList.toggle('focused', el.dataset.sec===sec));
    const data = SETTINGS_SECTIONS[sec] || SETTINGS_SECTIONS.general;
    document.getElementById('settingsSectionTitle').textContent = data.title;
    const body = document.getElementById('settingsContent');
    body.innerHTML = '';
    data.rows.forEach(row=>{
      const div = document.createElement('div');
      div.className = 'setting-row focusable';
      let desc = row.desc;
      if(row.dynamic === 'deviceId') desc = getDeviceId();
      div.innerHTML = `<div><div class="label">${row.label}</div><div class="desc">${desc}</div></div>` +
        (row.soon ? '<span class="badge-soon">YAKINDA</span>' : '');
      if(row.action === 'connect') div.onclick = ()=> Connect.start();
      body.appendChild(div);
    });
    Focus.refresh('settings');
  }
};

// ---------------- Girdi (klavye + sanal kumanda) ----------------
const Input = {
  init(){
    document.addEventListener('keydown', e=>{
      const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
        Enter:'ok', ' ':'ok', Backspace:'back', Escape:'back' };
      const action = map[e.key];
      if(action) this.handle(action);
    });
    document.querySelectorAll('#remote [data-key]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const k = btn.dataset.key;
        const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
          Enter:'ok', Back:'back', Home:'home', ChanUp:'chanup', ChanDown:'chandown' };
        this.handle(map[k] || k);
      });
    });
    document.getElementById('remote-toggle').addEventListener('click', ()=>{
      document.getElementById('remote').classList.toggle('hidden');
    });
    document.getElementById('btnFullscreen').addEventListener('click', ()=>{
      const el = document.documentElement;
      if(!document.fullscreenElement) el.requestFullscreen?.().catch(()=>{});
      else document.exitFullscreen?.();
    });
    // Küçük ekranlarda sanal kumanda toggle görünür
    if(window.innerWidth < 900) document.getElementById('remote-toggle').style.display='flex';
  },
  handle(action){
    const id = Screens.current;
    if(action==='up' || action==='down'){ Focus.move(action); return; }
    if(action==='ok'){ Focus.activate(); return; }
    if(action==='back'){ this.back(); return; }
    if(action==='home'){ if(App.sources && App.sources.length) ChannelUI.render(); else Connect.start(); return; }
    if(id==='player'){
      if(action==='chanup' || action==='chandown'){ /* basit: önizleme listesine dönmeden kanal atlama — v2 */ }
    }
  },
  back(){
    const id = Screens.current;
    if(id==='player'){ Player.close(); return; }
    if(id==='settings'){ ChannelUI.render(); return; }
    if(id==='empty'){ Connect.start(); return; }
    if(id==='home'){ /* TV'de genelde ana ekranda geri = çık; test ortamında bir şey yapmaz */ return; }
    if(id==='connect'){ return; }
  }
};

// ---------------- Ayarlar menü tıklamaları ----------------
document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.s-item').forEach(el=>{
    el.addEventListener('click', ()=> SettingsUI.open(el.dataset.sec));
  });
  document.getElementById('btnOpenSettings').addEventListener('click', ()=> SettingsUI.open('general'));
  document.getElementById('btnSettingsBack').addEventListener('click', ()=>{
    if(App.sources && App.sources.length) ChannelUI.render(); else Connect.start();
  });
  document.getElementById('btnEmptyBack').addEventListener('click', ()=> Connect.start());
  document.getElementById('btnEmptyConnect').addEventListener('click', ()=> Connect.start());
  document.getElementById('btnRotatePin').addEventListener('click', ()=> Connect.refresh(true));
  Input.init();
});

// ---------------- Uygulama girişi ----------------
const App = { sources: null };
(async function boot(){
  Screens.show('loading');
  await new Promise(r=>setTimeout(r, 400)); // kısa marka animasyonu
  const sources = await Panel.sources();
  if(sources && sources.length){
    App.sources = sources;
    ChannelUI.render();
  } else {
    await Connect.start();
  }
})();
