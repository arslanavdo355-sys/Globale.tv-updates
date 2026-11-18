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

// ---------------- Cihaz kimliği (TV donanımına bağlı, kalıcı) ----------------
// webOS, uygulama silinip tekrar kurulsa BİLE aynı kalan bir sistem kimliği sağlar:
// LGUDID (LG Unique Device ID), Luna Service Bus üzerinden "luna://com.webos.service.sm"
// servisinin "deviceid/getIDs" metoduyla okunur. Bu, uygulamanın kendi deposuna değil,
// TV'nin sistemine kayıtlıdır — uygulama kaldırılıp tekrar kurulduğunda da değişmez.
// NOT: Bu, gerçek bir LG TV veya webOS Simulator'da henüz test edilmedi (elimde fiziksel
// cihaz yok) — bu yüzden "test edildi" olarak raporlanmıyor; sadece resmi webOS API'sine
// göre hazırlandı. webOS çalışma zamanı yoksa (bu tarayıcı-test ortamı gibi) tarayıcıya
// özel kalıcı bir ID'ye düşülür — bu bir SAHTE MAC değildir, yalnızca test ortamı içindir.
function uuidLike(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8);
    return v.toString(16);
  });
}
let _cachedDeviceId = null;
function getLunaDeviceId(){
  return new Promise(resolve=>{
    if(!window.webOS || !window.webOS.service || typeof window.webOS.service.request !== 'function'){
      resolve(null); return;
    }
    try{
      window.webOS.service.request('luna://com.webos.service.sm', {
        method: 'deviceid/getIDs',
        parameters: { idType: ['LGUDID'] },
        onSuccess: (res)=>{
          const id = res && res.idList && res.idList[0] && res.idList[0].idValue;
          resolve(id || null);
        },
        onFailure: ()=> resolve(null),
      });
    }catch(e){ resolve(null); }
  });
}
async function getDeviceId(){
  if(_cachedDeviceId) return _cachedDeviceId;
  const lunaId = await getLunaDeviceId();
  if(lunaId){
    _cachedDeviceId = 'TV-' + lunaId;
    try{ localStorage.setItem(LS_DEVICE_ID, _cachedDeviceId); }catch(e){}
    return _cachedDeviceId;
  }
  let id = null;
  try{ id = localStorage.getItem(LS_DEVICE_ID); }catch(e){}
  if(!id){
    id = 'WEBOS-' + uuidLike().toUpperCase().replace(/-/g,'').slice(0,12);
    try{ localStorage.setItem(LS_DEVICE_ID, id); }catch(e){}
  }
  _cachedDeviceId = id;
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
  corsBlocked: false,
  async _call(path, method, body){
    const headers = {
      'x-device-mac': await getDeviceId(),
      'x-device-secret': getSecret(),
    };
    let opts = { method, headers };
    if(body){ headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try{
      const res = await fetch(PANEL_BASE + path, opts);
      const text = await res.text().catch(()=> '');
      let json = null;
      try{ json = text ? JSON.parse(text) : null; }catch(e){}
      return { ok: res.ok, status: res.status, json };
    }catch(networkErr){
      // Tarayıcı CORS'u reddettiğinde veya ağ erişilemez olduğunda fetch burada atar.
      // Ekranı sonsuza dek "yükleniyor" durumunda bırakmamak için zarifçe başarısız olunur.
      this.corsBlocked = true;
      return { ok:false, status:0, json:null };
    }
  },
  async hello(rotate){
    const body = { mac: await getDeviceId(), secret: getSecret() };
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
    document.getElementById('tvClock')?.classList.toggle('show', id === 'home');
    Focus.onScreenChange(id);
  }
};

// ---------------- Saat / tarih (yalnızca ana ekranda, orijinal uygulamadaki gibi) ----------------
const Clock = {
  timer: null,
  start(){
    this.tick();
    clearInterval(this.timer);
    this.timer = setInterval(()=> this.tick(), 15000);
  },
  tick(){
    const now = new Date();
    const locale = { de:'de-DE', en:'en-US', tr:'tr-TR' }[getLang()] || 'de-DE';
    const te = document.getElementById('tcTime');
    const de = document.getElementById('tcDate');
    if(te) te.textContent = now.toLocaleTimeString(locale, { hour:'2-digit', minute:'2-digit' });
    if(de) de.textContent = now.toLocaleDateString(locale, { weekday:'short', day:'2-digit', month:'short' });
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
    // Ana ekranda orijinal uygulamadaki gibi ilk tuşa basılana kadar odak çerçevesi gösterilmez
    this.stack[id] = { items, index: id === 'home' ? -1 : 0 };
    if(id === 'home') items.forEach(el=>el.classList.remove('focused'));
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
    document.getElementById('connectDeviceId').textContent = await getDeviceId();
    document.getElementById('connectPanelAddr').textContent = PANEL_DISPLAY;
    await this.refresh(false);
  },
  async refresh(rotate){
    document.getElementById('connectStatus').textContent = t('connecting');
    const session = await Panel.hello(rotate);
    if(!session){
      document.getElementById('connectStatus').textContent = Panel.corsBlocked
        ? t('panel_cors')
        : t('panel_unreachable');
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
        ? t('pin_refresh_in', { time: `${m}:${s}` })
        : t('pin_expired');
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
    const map = { m3u:t('group_m3u'), xtream:t('group_xtream'), url:t('group_url') };
    return map[kind] || t('group_other');
  },
  render(){
    this.buildGroups();
    const keys = Object.keys(this.groups);
    const sidebar = document.getElementById('sidebarGroups');
    const list = document.getElementById('channelList');
    sidebar.innerHTML = '';
    if(!keys.length){
      // Orijinal uygulamadaki gibi: Favoriten / Alle Sender sabit girişleri, 0 kanal.
      const ICON_HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-8.6-9.6C2.7 7.2 4.8 4.5 7.8 4.5c1.8 0 3.2 1 4.2 2.4 1-1.4 2.4-2.4 4.2-2.4 3 0 5.1 2.7 4.4 5.9C19.5 15.4 12 20 12 20z"/></svg>';
      const ICON_TV = '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 3.5L12 7l3.5-3.5"/></svg>';
      const favRow = document.createElement('div');
      favRow.className = 'group-item';
      favRow.innerHTML = `<span class="gi">${ICON_HEART}${t('fav_label')}</span><span class="count">0</span>`;
      const allRow = document.createElement('div');
      allRow.className = 'group-item active';
      allRow.innerHTML = `<span class="gi">${ICON_TV}${t('all_channels_label')}</span><span class="count">0</span>`;
      sidebar.appendChild(favRow); sidebar.appendChild(allRow);
      list.innerHTML = `<div class="list-empty">${t('list_empty_hint')}</div>`;
      document.getElementById('previewPane').classList.add('is-empty');
      document.getElementById('previewBox').innerHTML = '';
      document.getElementById('previewTitle').textContent = '—';
      document.getElementById('previewSub').textContent = t('preview_select');
      Screens.show('home');
      return;
    }
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
    document.getElementById('previewPane').classList.remove('is-empty');
    document.getElementById('previewTitle').textContent = ch.name || '—';
    document.getElementById('previewSub').textContent = ch.kind === 'xtream' ? t('group_xtream') : (ch.kind === 'm3u' ? t('group_m3u') : (ch.url||''));
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
      document.getElementById('playerMeta').textContent = t('no_playback_url');
      return;
    }
    if(Hls && Hls.isSupported() && /\.m3u8($|\?)/i.test(url)){
      this.hls = new Hls();
      this.hls.loadSource(url);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, ()=> video.play().catch(()=>{}));
      this.hls.on(Hls.Events.ERROR, (e, data)=>{
        if(data.fatal) document.getElementById('playerMeta').textContent = t('stream_failed') + ' (' + data.type + ')';
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
function SETTINGS_SECTIONS(){ return {
  general: { titleKey:'settings_general', rows:[
    { labelKey:'s_general_startup_l', descKey:'s_general_startup_d', soon:true },
    { labelKey:'s_general_reset_l', descKey:'s_general_reset_d', soon:true },
  ]},
  display:{ titleKey:'settings_display', rows:[
    { labelKey:'s_display_size_l', descKey:'s_display_size_d', soon:true },
    { labelKey:'s_display_hevc_l', descKey:'s_display_hevc_d', soon:true },
  ]},
  audio:{ titleKey:'settings_audio', rows:[
    { labelKey:'s_audio_lang_l', descKey:'s_audio_lang_d', soon:true },
    { labelKey:'s_sub_lang_l', descKey:'s_sub_lang_d', soon:true },
  ]},
  player:{ titleKey:'settings_player', rows:[
    { labelKey:'s_player_reconnect_l', descKey:'s_player_reconnect_d', soon:true },
    { labelKey:'s_player_recent_l', descKey:'s_player_recent_d', soon:true },
  ]},
  lang:{ titleKey:'settings_lang', custom:'lang' },
  qr:{ titleKey:'settings_qr', rows:[
    { labelKey:'s_qr_connect_l', descKey:'s_qr_connect_d', soon:false, action:'connect' },
  ]},
  sources:{ titleKey:'settings_sources', rows:[
    { labelKey:'s_sources_manage_l', descKey:'s_sources_manage_d', descParams:{panel:PANEL_DISPLAY}, soon:false, action:'connect' },
  ]},
  backup:{ titleKey:'settings_backup', rows:[
    { labelKey:'s_backup_export_l', descKey:'s_backup_export_d', soon:true },
  ]},
  about:{ titleKey:'settings_about', rows:[
    { labelKey:'s_about_version_l', descKey:'s_about_version_d', soon:false },
    { labelKey:'s_about_device_l', dynamic:'deviceId', soon:false },
  ]},
};}
const SettingsUI = {
  currentSection: 'general',
  open(sec){
    this.currentSection = sec;
    Screens.show('settings');
    document.querySelectorAll('.s-item').forEach(el=>el.classList.toggle('focused', el.dataset.sec===sec));
    const data = SETTINGS_SECTIONS()[sec] || SETTINGS_SECTIONS().general;
    document.getElementById('settingsSectionTitle').textContent = t(data.titleKey);
    const body = document.getElementById('settingsContent');
    body.innerHTML = '';
    if(data.custom === 'lang'){ this.renderLangPicker(body); Focus.refresh('settings'); return; }
    data.rows.forEach(row=>{
      const div = document.createElement('div');
      div.className = 'setting-row focusable';
      const isDyn = row.dynamic === 'deviceId';
      const desc = isDyn ? '…' : t(row.descKey, row.descParams);
      div.innerHTML = `<div><div class="label">${t(row.labelKey)}</div><div class="desc"${isDyn ? ' data-dyn="deviceId"' : ''}>${desc}</div></div>` +
        (row.soon ? `<span class="badge-soon">${t('soon')}</span>` : '');
      if(row.action === 'connect') div.onclick = ()=> Connect.start();
      body.appendChild(div);
    });
    if(data.rows.some(r=>r.dynamic==='deviceId')){
      getDeviceId().then(id=>{
        const el = body.querySelector('[data-dyn="deviceId"]');
        if(el) el.textContent = id;
      });
    }
    Focus.refresh('settings');
  },
  renderLangPicker(body){
    const current = getLang();
    SUPPORTED_LANGS.forEach(code=>{
      const hasFull = !!I18N[code];
      const div = document.createElement('div');
      div.className = 'setting-row focusable';
      div.innerHTML = `<div><div class="label">${LANG_NAMES[code] || code}</div></div>` +
        (code === current ? '<span class="badge-soon" style="color:var(--ok); border-color:var(--ok);">✓</span>'
          : (hasFull ? '' : `<span class="badge-soon">${t('soon')}</span>`));
      div.onclick = ()=>{
        setLang(code);
        applyStaticI18n();
        Clock.tick();
        this.open('lang');
      };
      body.appendChild(div);
    });
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
    if(id==='settings'){ App.sources ? ChannelUI.render() : Connect.start(); return; }
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
  document.getElementById('btnNavSettings').addEventListener('click', ()=> SettingsUI.open('general'));
  document.getElementById('btnSettingsBack').addEventListener('click', ()=>{
    App.sources ? ChannelUI.render() : Connect.start();
  });
  document.getElementById('btnEmptyBack').addEventListener('click', ()=> Connect.start());
  document.getElementById('btnEmptyConnect').addEventListener('click', ()=> Connect.start());
  document.getElementById('btnEmptySettings').addEventListener('click', ()=> SettingsUI.open('general'));
  document.getElementById('btnRotatePin').addEventListener('click', ()=> Connect.refresh(true));
  document.getElementById('btnSkipDemo').addEventListener('click', ()=>{
    clearInterval(Connect.timer);
    App.sources = [];
    ChannelUI.render();
  });
  Input.init();
});

// ---------------- Uygulama girişi ----------------
const App = { sources: null };
// 1 tasarım pikseli (orijinal 1920×1080 çizim) = TV ekranı genişliği / 1920
function applyDesignScale(){
  const s = document.getElementById('tv-screen');
  if(s) s.style.setProperty('--u', (s.getBoundingClientRect().width / 1920) + 'px');
}
window.addEventListener('resize', applyDesignScale);
document.addEventListener('fullscreenchange', applyDesignScale);

(async function boot(){
  applyDesignScale();
  applyStaticI18n();
  Clock.start();
  document.getElementById('emptyBody').textContent = t('empty_body', { panel: PANEL_DISPLAY });
  Screens.show('loading');
  // Orijinal açılış animasyonu (~3,4 sn) tamamlanana kadar bekle; panel isteği paralel çalışır
  const splashDone = new Promise(r=>setTimeout(r, 3600));
  const sourcesP = Panel.sources();
  await splashDone;
  const sources = await sourcesP;
  if(sources && sources.length){
    App.sources = sources;
    ChannelUI.render();
  } else {
    await Connect.start();
  }
})();
