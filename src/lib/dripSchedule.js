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

// ─── Lifecycle / signup emails ─────────────────────────
// SOURCE OF TRUTH: supabase/functions/send-vendor-email/index.ts
// These fire automatically when accounts are created or applications change
// state. Mirrored here for the read-only schedule view. If you edit the
// edge function templates, update these too.

const memberFirstName = 'First Name';
const exampleEmail = 'vendor@example.com';
const examplePhone = '(555) 123-4567';

export const LIFECYCLE_GROUPS = [
  {
    trigger: 'Vendor signs up',
    triggerLabel: 'New vendor account',
    description: 'A new vendor completes the vendor signup form on the website.',
    emails: [
      {
        key: 'vendor_welcome.vendor',
        audienceLabel: 'To the vendor',
        audienceColor: '#16a34a',
        subject: 'Welcome to Trainer Center HB vendors',
        html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
          `<p>Your vendor profile is in. Chef will personally review it before approving you. Once approved, you can apply for any upcoming Vendor Day in two clicks from your dashboard.</p>` +
          `<p><strong>Vendor Day cadence:</strong> last Friday of every month at the shop.</p>` +
          `<p>While you wait, drop by Trainer Center HB or follow <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a> on Instagram.</p>`,
      },
      {
        key: 'vendor_welcome.staff',
        audienceLabel: 'To staff',
        audienceColor: '#C8102E',
        subject: `New partner application: ${EXAMPLE.vendorName}`,
        html: `<p><strong>${EXAMPLE.vendorName}</strong> just applied to become a Trainer Center HB vendor partner.</p>` +
          `<p style="font-size:13px;color:#444">${exampleEmail} · ${examplePhone}<br/>Specialty: Vintage singles<br/>IG: @${EXAMPLE.vendorName.toLowerCase().replace(' ', '')}<br/>Experience: intermediate</p>`,
      },
    ],
  },
  {
    trigger: 'Member signs up',
    triggerLabel: 'New member account',
    description: 'A new community member completes the member signup form.',
    emails: [
      {
        key: 'member_welcome.member',
        audienceLabel: 'To the member',
        audienceColor: '#16a34a',
        subject: 'Welcome to the Trainer Center HB community',
        html: `<p>Hi ${memberFirstName},</p>` +
          `<p>You're in! You can vote for your favorite vendors at any future Vendor Day. Voting opens at the shop on event day — just tap <strong>Review Vendors</strong> on the Vendors page when you're here.</p>` +
          `<p><strong>Vendor Day cadence:</strong> last Friday of every month.</p>` +
          `<p>We'll send you a reminder a few days before the next one. No spam, no list-selling — just shop news.</p>`,
      },
    ],
  },
  {
    trigger: 'Chef approves a vendor profile',
    triggerLabel: 'Vendor partner approved',
    description: 'Staff marks a vendor profile as approved in /staff/vendors.',
    emails: [
      {
        key: 'vendor_profile_approved.vendor',
        audienceLabel: 'To the vendor',
        audienceColor: '#16a34a',
        subject: "Action required: You're a Trainer Center HB vendor — pick your dates",
        html: `<p style="font-size:15px;color:#16a34a;font-weight:700;margin:0 0 4px">Approved as a vendor partner</p>` +
          `<p style="margin:0 0 20px">Hi ${EXAMPLE.vendorName},</p>` +
          `<p style="margin:0 0 24px">You're now a recognized Trainer Center HB vendor partner. Welcome.</p>` +
          `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:6px;margin:0 0 20px"><p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#92400e;letter-spacing:0.04em">YOU'RE NOT DONE YET</p><p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5">Being approved as a partner does <strong>not</strong> put you on a Vendor Day automatically. You still need to pick which dates you want to be at.</p></div>` +
          `<p style="margin:0 0 12px;font-weight:700">Each Vendor Day requires a quick per-event sign-up:</p>` +
          `<ol style="margin:0;padding-left:20px;color:#444;font-size:14px;line-height:1.7"><li>Open your dashboard</li><li>Pick the Vendor Days you want</li><li>Chef confirms each one within a day or two</li></ol>`,
      },
    ],
  },
  {
    trigger: 'Vendor applies for a Vendor Day',
    triggerLabel: 'New event application',
    description: 'An approved vendor applies for a specific Vendor Day from their dashboard.',
    emails: [
      {
        key: 'application_received.vendor',
        audienceLabel: 'To the vendor',
        audienceColor: '#16a34a',
        subject: `Got your application for ${EXAMPLE.dateStr}`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p><p>We got your interest in vending on <strong>${EXAMPLE.dateStr}</strong> for <strong>${EXAMPLE.eventTitle}</strong>. Chef will confirm your spot soon.</p>`,
      },
      {
        key: 'application_received.staff',
        audienceLabel: 'To staff',
        audienceColor: '#C8102E',
        subject: `${EXAMPLE.vendorName} wants to vend on ${EXAMPLE.dateStr}`,
        html: `<p><strong>${EXAMPLE.vendorName}</strong> applied for ${EXAMPLE.eventTitle} on ${EXAMPLE.dateStr}.</p>` +
          `<p style="font-size:13px;color:#444">${exampleEmail} · ${examplePhone}<br/>Specialty: Vintage singles<br/>IG: @vendorname</p>`,
      },
    ],
  },
  {
    trigger: 'Chef approves an application',
    triggerLabel: 'Application approved',
    description: 'Staff approves a vendor application for a specific event.',
    emails: [
      {
        key: 'application_decided.approved',
        audienceLabel: 'To the vendor',
        audienceColor: '#16a34a',
        subject: `You're in for ${EXAMPLE.dateStr}`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
          `<p>Chef approved your application for <strong>${EXAMPLE.eventTitle}</strong> on <strong>${EXAMPLE.dateStr}</strong> from <strong>${EXAMPLE.vendorTimes}</strong>.</p>` +
          `<p>Bring your inventory, your energy, and your A-game. When you arrive on event day, log in and tap <strong>Check in</strong> on your dashboard. After the event you can come back and upload photos and a clip from your table — those go on our public Vendors page.</p>` +
          `<div style="background:#fff0f0;border-left:4px solid #C8102E;padding:14px 18px;border-radius:6px;margin:18px 0"><p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#C8102E;letter-spacing:0.04em">PROMOTE YOUR TABLE</p><p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5">Your logo and socials are live on the public lineup page. Share the link with your community to drive traffic to your table that day.</p></div>`,
      },
    ],
  },
  {
    trigger: 'Chef declines an application',
    triggerLabel: 'Application declined',
    description: 'Staff declines a vendor application for a specific event.',
    emails: [
      {
        key: 'application_decided.declined',
        audienceLabel: 'To the vendor',
        audienceColor: '#9ca3af',
        subject: `About your Vendor Day application`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
          `<p>Thanks for applying for <strong>${EXAMPLE.eventTitle}</strong> on <strong>${EXAMPLE.dateStr}</strong>. We aren't able to accommodate you this time.</p>` +
          `<p>You're welcome to apply for future Vendor Days. We appreciate your interest in Trainer Center HB.</p>`,
      },
    ],
  },
  {
    trigger: 'Staff cancels a Vendor Day',
    triggerLabel: 'Event cancelled',
    description: 'Staff cancels an event. Every applicant (approved + pending) gets notified.',
    emails: [
      {
        key: 'event_cancelled.vendor',
        audienceLabel: 'To every applicant',
        audienceColor: '#dc2626',
        subject: `Cancelled: ${EXAMPLE.eventTitle} on ${EXAMPLE.dateStr}`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
          `<p>We had to cancel <strong>${EXAMPLE.eventTitle}</strong> on <strong>${EXAMPLE.dateStr}</strong>. You had been approved as a vendor for this date — apologies for the change.</p>` +
          `<p>The next Vendor Day is on the calendar. We'll see you there.</p>`,
      },
    ],
  },
];
