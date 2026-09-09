/* Request app V1 — configuration.
   DEMO MODE: leave SUPABASE_URL empty. Everything works in this browser only.
   LIVE MODE: paste the Supabase project URL + anon key, and list the team. */

window.APP_CONFIG = {
  COMPANY_NAME: 'Astute Fire',         // shown to customers on the form
  COMPANY_INITIAL: 'A',                // fallback when no logo is set
  /* Company logo (inline SVG) — shown in the top-left of the customer form.
     Leave empty ('') to fall back to a coloured square with the initial. */
  COMPANY_LOGO: '<svg viewBox="0 0 24 24"><path fill="#439263" d="M12.6 3c.2 2.4-.6 4-1.9 5.4-.5-.7-.8-1.4-.9-2.3C8 7.6 6.8 9.7 6.8 12.1a5.6 5.6 0 0 0 11.2 0C18 8 14.8 5.5 12.6 3z"/></svg>',
  BRAND_COLOR: '#439263',              // Astute green — available to the pages that want it
  COMPANY_PHONE: '(02) 9481 0000',     // tap-to-call on the customer form; empty = hidden

  /* Call-out rates (Dad's rate table, 2026-08-20; rate rule settled in the car
     2026-08-26) — applies to Service call + Urgent requests. The rate follows
     WHEN THE COMPANY ATTENDS, not when the request is logged:
     - Service call: the form shows the whole rate card (both figures) and
       Accept means accepting the card, not one number. The office's booked
       visit time picks the rate off this table, and the booking text tells
       the customer the time and the rate together.
     - Urgent: they want someone now, so now's rate shows and freezes at Accept.
     Weekends and public holidays have their own slots.
     - Every figure is a setting here. Nothing is hardcoded in the pages.
     - A slot with amount: null isn't set yet — it falls back to the
       after-hours rate, so nothing breaks while Dad confirms the numbers.
     - publicHolidays: dates as 'YYYY-MM-DD', top up each year. Empty list =
       holidays just follow the weekday/weekend rules.
     Set RATES: null to turn call-out costs off entirely. */
  RATES: {
    label: 'ex GST',
    normalHours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00' },  // Mon–Fri 8am–4pm
    normal:        { amount: 75,   name: 'normal hours' },
    afterHours:    { amount: 180,  name: 'after hours' },
    saturday:      { amount: null, name: 'Saturday' },       // TBC by Dad
    sunday:        { amount: null, name: 'Sunday' },         // TBC by Dad
    publicHoliday: { amount: null, name: 'public holiday' }, // TBC by Dad
    publicHolidays: [],
    /* $/hr after the first hour (Dad, 2026-08-25: the call-out covers the
       first hour, every hour after is at the company's set rate; 2026-08-26:
       the figure is each company's own call). Set the amount and the fee card
       starts saying "covers the first hour, then $X an hour" — and the figure
       rides on the request so the office sees what the customer agreed to.
       null = the card just says extra work is quoted or charged on the day. */
    hourly: { amount: null }
  },

  /* The company's own terms and conditions — Dad's ask (2026-08-25): a config
     area where each company writes its own. Shown as an expandable "Our terms"
     under the call-out cost, so the customer can read them before accepting.
     One short line per entry, plain words. Empty list [] hides it entirely.
     These lines are examples built from Dad's own list (2026-08-20) — he
     confirms or rewords them before this goes anywhere near a real customer. */
  TERMS: [
    'The call-out fee covers the visit and the first hour of work.',
    'Work after the first hour is charged at our hourly rate.',
    'Parts are charged separately.',
    'If we arrive and can’t get access, a cancellation fee may apply.',
    'All prices are ex GST.'
  ],

  /* Days this company actually works. The customer can't pick anything else —
     no point offering a day nobody was ever coming. 0=Sun, 1=Mon … 6=Sat.
     Mon–Fri is [1,2,3,4,5]; add 6 for Saturdays, 0 for Sundays.
     Delete this line entirely and all seven days stay open. */
  WORKING_DAYS: [1, 2, 3, 4, 5],

  /* The nag's pace — hours until a waiting request goes orange, then red, per type.
     Service runs at Dad's stated pace (back to them within the hour, visit within 2),
     so a service call sitting untouched for an hour is already orange. Quotes and
     other requests run on days. Urgent isn't listed — it's red from minute one.
     Loosen these when the reality check hurts; delete the line for the old 24/48 pace. */
  WAIT_CLOCK: { service: [1, 2], quote: [24, 48], other: [24, 48] },

  /* The urgent ping (built 2026-08-31, top of the V2 list). An urgent request
     can't be allowed to sit unseen while everyone's on ladders, so the moment
     one lands the app makes a noise and pops a notification on any device that
     has the list open, and writes the words the on-call person should get.
     - ON_CALL: who gets told. Set the mobile to the phone that's actually on
       call. Set ON_CALL: null and the alert wording is skipped entirely.
     - repeatMins: while an urgent is still sitting with nobody on it, the ping
       repeats this often on an open device. 0 turns the repeat off.
     HONEST LIMIT: no real text goes out yet — same as every other message in
     V1, the app writes what WOULD be sent. And the noise + notification only
     reach a device with the app open. A ping that reaches a closed phone needs
     a sender (a Supabase function plus an SMS provider), and on an iPhone the
     app also has to be added to the home screen first. That's the next step. */
  ON_CALL: { name: 'Noah', phone: '0400 000 000' },
  URGENT_PING: { repeatMins: 5 },

  /* Address suggestions on the customer form. With a Google key: Google Places (every AU address, house
     numbers included). Without one: OpenStreetMap (free, misses many house numbers). Get the key at
     console.cloud.google.com → APIs & Services → enable "Places API (New)" → Credentials → API key,
     then restrict it to HTTP referrers (this site's URL) and to the Places API. Noah pastes it here himself. */
  GOOGLE_MAPS_KEY: 'AIzaSyD8OWu2csrz8g8EfSKTVRjTELWai8irxxY',
  SUPABASE_URL: 'https://lemepuchjumwjbqbjbkw.supabase.co',                    // e.g. https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_0_ewcS-gzck0o9jtSZIkMA_Gy08HIkB',

  /* Team shown on "Who's on it?" — name + avatar colour */
  TEAM: [
    { name: 'Noah', color: '#5ac8fa' },
    { name: 'Jake', color: '#af52de' },
    { name: 'Tom',  color: '#ff9500' }
  ],

  /* Demo-mode buildings (in live mode these come from the database) */
  BUILDINGS: [
    { code: 'harbourview', name: 'Harbourview Apartments', address: '12 Harbour St, Sydney', lat: -33.8523, lng: 151.2108 },
    { code: 'seaforth-rsl', name: 'Seaforth RSL', address: '3 Frenchs Rd, Seaforth', lat: -33.7994, lng: 151.2464 }
  ]
};
