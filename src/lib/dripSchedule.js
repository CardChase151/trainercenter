// Vendor drip schedule — read-only mirror for the /staff/comms "Drip Schedule" tab.
//
// SOURCE OF TRUTH: supabase/functions/vendor-event-drip/index.ts
// If you edit copy or timing in that edge function, update this file too.
// This file is display-only. The cron job does not read from here.

const EXAMPLE = {
  vendorName: 'Vendor Name',
  eventTitle: 'Vendor Day',
  dateStr: 'Saturday, June 7',
  vendorTimes: '12 PM - 5 PM',
};

const eventLine = `${EXAMPLE.eventTitle} · ${EXAMPLE.dateStr} · ${EXAMPLE.vendorTimes}`;

export const SIGNUP_AUDIENCE = 'Approved partner vendors who have NOT yet applied to this event.';
export const LINEUP_AUDIENCE = 'Vendors who have been approved FOR this event.';

export const SIGNUP_STEPS = [
  {
    key: 'signup.t21',
    daysLabel: '21 days before',
    daysSort: 21,
    subject: `Save the date — ${EXAMPLE.eventTitle} on ${EXAMPLE.dateStr}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>Heads up: <strong>${eventLine}</strong>. You're an approved partner — claim your table whenever you're ready.</p><p>Apply takes about 30 seconds.</p>`,
  },
  {
    key: 'signup.t14',
    daysLabel: '14 days before',
    daysSort: 14,
    subject: `2 weeks out — claim your spot for ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is two weeks away and the lineup is starting to fill in. Want a table?</p>`,
  },
  {
    key: 'signup.t7',
    daysLabel: '7 days before',
    daysSort: 7,
    subject: `One week to apply — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is <strong>one week from today</strong>. Spots are limited — apply now if you're in.</p>`,
  },
  {
    key: 'signup.t3',
    daysLabel: '3 days before',
    daysSort: 3,
    subject: `3 days left — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p><strong>${eventLine}</strong> is in 3 days. Spots fill up fast in the final week.</p><p>Want in?</p>`,
  },
  {
    key: 'signup.t2',
    daysLabel: '2 days before',
    daysSort: 2,
    subject: `2 days — last 48 hours to get on the list`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is in 2 days. After tomorrow it's going to be hard to slot you in.</p>`,
  },
  {
    key: 'signup.t1',
    daysLabel: '1 day before',
    daysSort: 1,
    subject: `Tomorrow — last chance for ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is <strong>tomorrow</strong>. This is the final window to get on the lineup.</p><p>One tap and you're in.</p>`,
  },
];

export const LINEUP_STEPS = [
  {
    key: 'lineup.t21',
    daysLabel: '21 days before',
    daysSort: 21,
    subject: `You're in — ${EXAMPLE.eventTitle} on ${EXAMPLE.dateStr}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>You're approved for <strong>${eventLine}</strong>. Three weeks out — let's make it big.</p>`,
  },
  {
    key: 'lineup.t14',
    daysLabel: '14 days before',
    daysSort: 14,
    subject: `2 weeks out — start telling your community`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is two weeks out. Now's a good time to start telling your community you'll be there.</p>`,
  },
  {
    key: 'lineup.t7',
    daysLabel: '7 days before',
    daysSort: 7,
    subject: `One week — post on IG and tag @trainercenter.pokemon`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is one week from today.</p><p>Big ask: <strong>post about it on IG and tag <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a></strong>. We'll repost the best ones.</p>`,
  },
  {
    key: 'lineup.t3',
    daysLabel: '3 days before',
    daysSort: 3,
    subject: `3 days out — big push, post + tag us`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p><strong>${eventLine}</strong> is in 3 days. This is the push window.</p><ul><li>Post on your IG today</li><li>Tag <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a></li><li>Story it. Reels are best.</li></ul><p>You bring traffic, we bring traffic, everyone wins.</p>`,
  },
  {
    key: 'lineup.t2',
    daysLabel: '2 days before',
    daysSort: 2,
    subject: `2 days out — quick logistics for ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p>${eventLine} is in 2 days. Confirmed time slot: <strong>${EXAMPLE.vendorTimes}</strong>.</p><p>Bring your singles, slabs, sealed product — whatever you specialize in. Tables and chairs provided.</p>`,
  },
  {
    key: 'lineup.t1',
    daysLabel: '1 day before',
    daysSort: 1,
    subject: `Tomorrow! ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p><strong>${eventLine}</strong> is tomorrow.</p><p>Final reminders:</p><ul><li>Arrive ~30 min early to set up</li><li>4911 Warner Ave #210, Huntington Beach</li><li>Park anywhere in the lot</li></ul><p>If you haven't posted on IG yet, today's the day. Tag us.</p>`,
  },
  {
    key: 'lineup.t0',
    daysLabel: 'Day of — morning',
    daysSort: 0,
    subject: `See you there! ${EXAMPLE.eventTitle} today`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p><p><strong>Today's the day.</strong> ${eventLine}.</p><p>See you at the shop. Drive safe, bring water.</p>`,
  },
];
