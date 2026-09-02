/* Request app V1 — data layer.
   Two modes:
   - DEMO MODE (no Supabase keys set): data lives in this browser's localStorage.
     Good for testing the whole loop on one device with zero accounts.
   - LIVE MODE (keys set in config.js): data lives in Supabase, list updates in
     realtime, company side requires magic-link login. */

const DEMO = !window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL;

/* ---------------- shared helpers ---------------- */
function uid(){ return 'r' + Math.random().toString(36).slice(2, 10); }
function nowISO(){ return new Date().toISOString(); }

/* booking labels are UI shorthand ("Mon 10 Aug · AM") — texts speak in words ("Monday morning, 10 Aug") */
const DAY_WORDS = { Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday', Sat:'Saturday', Sun:'Sunday' };
function whenWords(label){
  if(!label) return '';
  if(label === 'ASAP') return 'as soon as possible';
  const [day, pref] = label.split(' · ');
  const parts = (day || '').split(' ');
  const dayFull = (DAY_WORDS[parts[0]] || parts[0]);
  const rest = parts.slice(1).join(' ');
  if(pref === 'AM') return `${dayFull} morning, ${rest}`;
  if(pref === 'PM') return `${dayFull} afternoon, ${rest}`;
  if(!pref || pref === 'Anytime') return `${dayFull} ${rest}`;
  return `${dayFull} ${rest}, between ${pref}`;   /* custom window like 10am–2pm */
}
window.whenWords = whenWords;

/* customer texts — reworded with Noah 2026-08-10: company named once (first text),
   no ref numbers, no promises we might not keep, day-times in words, changes ASK not tell */
function smsText(kind, req, extra){
  const name = (req.customer_name || 'there').split(' ')[0];
  const co = (window.APP_CONFIG && window.APP_CONFIG.COMPANY_NAME) || 'us';
  if(kind === 'received'){
    /* urgent gets the safety valve — nobody's accepted the job yet, so the text
       gives them something to do if we go quiet (Noah 2026-08-17) */
    const phone = window.APP_CONFIG && window.APP_CONFIG.COMPANY_PHONE;
    return `Got it, ${name}. This is ${co}, you'll hear from us soon.`
      + (req.urgent && phone ? ` If it gets worse, ring us on ${phone}.` : '');
  }
  if(kind === 'seen'){
    /* the seen text (Dad's rule from the car 2026-08-26, wording Noah 2026-08-28):
       a human's eyes are on it, nothing more — the office can still decline, so
       no "we're onto it" and no promised booking. "We'll be in touch" covers both. */
    if(req.urgent || req.req_type === 'urgent') return `Hi ${name}, someone's looking at your request right now.`;
    if(req.req_type === 'quote') return `Hi ${name}, we're having a look at your quote request now. We'll be in touch soon.`;
    return `Hi ${name}, we're having a look at your request now. We'll be in touch soon.`;
  }
  if(kind === 'done')     return `All done. ${extra ? extra + ' sorted it' : "It's sorted"}. If anything's not right, call us anytime.`;
  if(kind === 'custom')   return extra; /* caller built the whole sentence (batched texts) */
  /* (assigned/booked/rebooked/declined kinds removed 2026-08-28 — every one of those
     paths composes its own sentence now; dead wordings here could silently drift) */
  return '';
}

/* One update, two ways to deliver it. A mobile gets the text; a landline can't, so the
   same words become what the office says when they ring (Noah 2026-08-30). Both are a
   record of what the customer was told — the difference is the channel, and the record
   has to name it honestly. Used by both stores so demo and live can't drift. */
function msgEvent(req, kind, extra){
  const words = smsText(kind, req, extra);
  /* the channel lives in the TEXT prefix, not a flag — the live store's events table has
     an sms column and nothing else, so a prefix keeps both stores identical without a
     schema change, and old rows (all 'SMS→') keep reading exactly as they always did. */
  return (req && req.phone_kind === 'landline')
    ? { at: nowISO(), text: 'TOSAY→ ' + words }
    : { at: nowISO(), text: 'SMS→ ' + words, sms: true };
}

/* The urgent ping (2026-08-31). What the on-call person gets told when an urgent
   lands. Written for someone reading it on a phone at 2am: what, where, who to
   ring, and the ref. No greeting, no company name — they know who they work for.
   Same honesty rule as the customer texts: nothing is actually sent yet, this is
   the record of what would go out. Lives here so the demo store and the database
   trigger say the same words. */
function alertText(req){
  const oc = window.APP_CONFIG && window.APP_CONFIG.ON_CALL;
  if(!oc) return '';
  const bits = [
    'URGENT — ' + (req.building_name || 'site unknown'),
    req.category || '',
    (req.customer_name || 'customer') + ', ' + (req.customer_phone || 'no number'),
    req.ref || ''
  ].filter(Boolean);
  return bits.join('. ') + '.';
}
window.alertText = alertText;

/* ---------------- demo store (localStorage) ---------------- */
const DemoStore = {
  live: DEMO,
  _read(){ try { return JSON.parse(localStorage.getItem('reqapp') || '{"requests":[],"events":{}}'); } catch(e){ return {requests:[],events:{}}; } },
  _write(d){ localStorage.setItem('reqapp', JSON.stringify(d)); },

  /* buildings: the ones in config plus any added from the Buildings tab (saved in this browser) */
  _buildings(){ const d = this._read(); return (window.APP_CONFIG.BUILDINGS || []).concat(d.buildings || []); },
  async getBuilding(code){
    const b = this._buildings().find(x => x.code === code);
    return b || null;
  },
  async listBuildings(){
    return this._buildings().slice().sort((a, b) => a.name.localeCompare(b.name));
  },
  async addBuilding(b){
    if(this._buildings().some(x => x.code === b.code)) throw new Error('code taken');
    const d = this._read();
    d.buildings = d.buildings || [];
    d.buildings.push({ code: b.code, name: b.name, address: b.address || '' });
    this._write(d);
    return b;
  },
  async createRequest(req){
    const d = this._read();
    req.id = uid();
    /* counter, not a count — deleting a request must not hand its number out again */
    d.refSeq = Math.max(1001, (d.refSeq || 1001));
    req.ref = 'R-' + d.refSeq;
    d.refSeq++;
    req.status = 'new';
    req.created_at = nowISO();
    d.requests.push(req);
    /* a landline can't receive the receipt text — the timeline must not claim one went
       out (2026-08-28 review; the receipt screen already says "We'll call you") */
    d.events[req.id] = [
      { at: nowISO(), text: 'received · ' + (req.customer_name||'customer').split(' ')[0] + ' got a receipt' },
      req.phone_kind === 'landline'
        ? { at: nowISO(), text: 'receipt not texted — landline, give them a ring' }
        : { at: nowISO(), text: 'SMS→ ' + smsText('received', req), sms: true }
    ];
    /* an urgent gets the on-call person told straight away (2026-08-31). It sits in
       the record, not in the customer's thread — the thread is what the CUSTOMER was
       told, and this went the other way. The noise and the notification are the office
       app's job (index.html); this is the written half. */
    if(req.urgent && alertText(req)){
      d.events[req.id].push({ at: nowISO(), text: 'ALERT→ ' + alertText(req) });
    }
    /* the accepted call-out goes on the record, timestamped — rate named so the
       office can see at a glance why it's $180 and not $75 */
    if(req.scc_accepted && req.scc_amount){
      d.events[req.id].push({ at: nowISO(), text: 'call-out accepted · $' + req.scc_amount + ' ex GST'
        + (req.rate_type && req.rate_type !== 'normal hours' ? ' · ' + req.rate_type : '')
        + (req.hourly_amount ? ' · then $' + req.hourly_amount + '/hr' : '') });
    } else if(req.scc_accepted && req.rate_card){
      /* service calls accept the whole card (2026-08-26 rule) — no single figure
         yet; the booked time locks one in later and that gets its own event */
      d.events[req.id].push({ at: nowISO(), text: 'rate card accepted · $' + req.rate_card.normal
        + ' ' + (req.rate_card.window || '') + ' / $' + req.rate_card.after + ' outside'
        + (req.hourly_amount ? ' · then $' + req.hourly_amount + '/hr' : '') });
    }
    this._write(d);
    return req;
  },
  async listRequests(){
    return this._read().requests.slice().sort((a,b)=> b.created_at.localeCompare(a.created_at));
  },
  async getRequest(id){
    return this._read().requests.find(r => r.id === id) || null;
  },
  async getEvents(id){
    return (this._read().events[id] || []).slice();
  },
  async updateRequest(id, patch, eventText, smsKind, smsExtra){
    const d = this._read();
    const r = d.requests.find(x => x.id === id);
    if(!r) return null;
    Object.assign(r, patch);
    if(eventText) (d.events[id] = d.events[id] || []).push({ at: nowISO(), text: eventText });
    if(smsKind)   (d.events[id] = d.events[id] || []).push(msgEvent(r, smsKind, smsExtra));
    this._write(d);
    return r;
  },
  async addEvent(id, text, sms){
    const d = this._read();
    (d.events[id] = d.events[id] || []).push({ at: nowISO(), text, ...(sms ? { sms: true } : {}) });
    this._write(d);
  },
  async addCustomerNote(id, note){
    const d = this._read();
    if(!d.requests.find(x => x.id === id)) return false;
    (d.events[id] = d.events[id] || []).push({ at: nowISO(), text: 'customer added · “' + note + '”' });
    this._write(d);
    return true;
  },
  onChange(cb){
    window.addEventListener('storage', e => { if(e.key === 'reqapp') cb(); });
  },
  /* auth is a no-op in demo mode */
  async getUser(){ return { email: 'demo@local' }; },
  async signIn(){ return { ok: true }; },
  async signOut(){}
};

/* ---------------- live store (Supabase) ---------------- */
const LiveStore = {
  live: true,
  _c: null,
  client(){
    if(!this._c) this._c = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);
    return this._c;
  },
  async getBuilding(code){
    const { data } = await this.client().from('buildings').select('code,name,address').eq('code', code).maybeSingle();
    return data;
  },
  async listBuildings(){
    const { data } = await this.client().from('buildings').select('code,name,address').order('name');
    return data || [];
  },
  async addBuilding(b){
    const { error } = await this.client().from('buildings').insert({ code: b.code, name: b.name, address: b.address || '' });
    if(error) throw new Error(/duplicate|unique/i.test(error.message) ? 'code taken' : error.message);
    return b;
  },
  async createRequest(req){
    /* Goes through a database function (2026-09-01 fix): a plain insert worked,
       but reading the row back for the receipt needs read access the customer
       rightly doesn't have. The function inserts and returns the row (with the
       sequence-assigned ref) in one privileged step. */
    const { data, error } = await this.client().rpc('create_request', { req });
    if(error) throw error;
    /* 'received' events are added by a database trigger */
    return data;
  },
  async listRequests(){
    const { data } = await this.client().from('requests').select('*').order('created_at', { ascending: false });
    return data || [];
  },
  async getRequest(id){
    const { data } = await this.client().from('requests').select('*').eq('id', id).maybeSingle();
    return data;
  },
  async getEvents(id){
    const { data } = await this.client().from('request_events').select('*').eq('request_id', id).order('at');
    return data || [];
  },
  async updateRequest(id, patch, eventText, smsKind, smsExtra){
    const { data, error } = await this.client().from('requests').update(patch).eq('id', id).select().single();
    if(error) throw error;
    const evs = [];
    if(eventText) evs.push({ request_id: id, text: eventText });
    if(smsKind){ const m = msgEvent(data, smsKind, smsExtra); evs.push({ request_id: id, text: m.text, sms: !!m.sms }); }
    if(evs.length) await this.client().from('request_events').insert(evs);
    return data;
  },
  async addEvent(id, text, sms){
    await this.client().from('request_events').insert([{ request_id: id, text, sms: !!sms }]);
  },
  async addCustomerNote(id, note){
    /* goes through a database function — the customer has no read/write access, the function checks the request is fresh */
    const { error } = await this.client().rpc('add_customer_note', { req_id: id, note });
    return !error;
  },
  onChange(cb){
    this.client().channel('reqs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, cb)
      .subscribe();
  },
  async getUser(){
    const { data } = await this.client().auth.getUser();
    return data.user || null;
  },
  async signIn(email){
    const { error } = await this.client().auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    return { ok: !error, error };
  },
  async signOut(){ await this.client().auth.signOut(); }
};

window.Store = DEMO ? DemoStore : LiveStore;
window.IS_DEMO = DEMO;
