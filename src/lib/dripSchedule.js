// Vendor drip schedule — read-only mirror for the /staff/comms "Drip Schedule" tab.
//
// SOURCE OF TRUTH: supabase/functions/vendor-event-drip/index.ts
// If you edit copy or timing in that edge function, update this file too.
// This file is display-only. The cron job does not read from here.

const EXAMPLE = {
  vendorName: 'Vendor Name',
  eventTitle: "TC's Beach City Trade Night",
  dateStr: 'Saturday, June 7',
  vendorTimes: '12 PM - 5 PM',
};

const eventLine = `${EXAMPLE.eventTitle} · ${EXAMPLE.dateStr} · ${EXAMPLE.vendorTimes}`;

export const SIGNUP_AUDIENCE = 'Approved partner vendors who have NOT yet applied to this event.';
export const LINEUP_AUDIENCE = 'Vendors who have been approved FOR this event.';

const cantMakeIt = `<p style="margin-top:18px;font-size:13px;color:#666">Plans changed? <a href="#" style="color:#666">Let us know</a> so we can plan ahead.</p>`;
const notInterested = `<p style="margin-top:18px;font-size:13px;color:#666">Not interested in this date? <a href="#" style="color:#666">Let us know</a> so we stop reminding you.</p>`;

export const SIGNUP_STEPS = [
  {
    key: 'signup.t21',
    daysLabel: '21 days before',
    daysSort: 21,
    subject: `Did you hear? ${EXAMPLE.eventTitle} on ${EXAMPLE.dateStr}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>Big announcement:</strong> we have an upcoming <strong>${eventLine}</strong>.</p>` +
      `<p>If you'd like to vend, click below to apply. Two clicks and you're on the list for review.</p>` +
      `<p style="margin:18px 0;text-align:center"><a href="#" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">Apply for this date</a></p>` +
      notInterested,
  },
  {
    key: 'signup.t14',
    daysLabel: '14 days before',
    daysSort: 14,
    subject: `Final reviews this week and next — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p>Heads up: Trainer Center HB is doing <strong>final reviews this week and next</strong> for <strong>${eventLine}</strong>.</p>` +
      `<p>If you're interested in vending, don't forget to apply.</p>` +
      `<p style="margin:18px 0;text-align:center"><a href="#" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">Apply for this date</a></p>` +
      notInterested,
  },
  {
    key: 'signup.t7',
    daysLabel: '7 days before',
    daysSort: 7,
    subject: `Final week — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p>We're in the <strong>final week</strong> before <strong>${eventLine}</strong>.</p>` +
      `<p>We've always appreciated you and would love to have you at this one. If you're in, apply now.</p>` +
      `<p style="margin:18px 0;text-align:center"><a href="#" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">Apply for this date</a></p>` +
      notInterested,
  },
  {
    key: 'signup.t3',
    daysLabel: '3 days before',
    daysSort: 3,
    subject: `Last chance — ${EXAMPLE.eventTitle} in 3 days`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>Last chance.</strong> There's still room available for <strong>${eventLine}</strong>.</p>` +
      `<p>If you want a table, today's the day to claim it.</p>` +
      `<p style="margin:18px 0;text-align:center"><a href="#" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">Apply now</a></p>` +
      notInterested,
  },
  {
    key: 'signup.t2',
    daysLabel: '2 days before',
    daysSort: 2,
    subject: `Only 48 hours left — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p>Only <strong>48 hours left</strong> to get on the list for <strong>${eventLine}</strong>.</p>` +
      `<p>After tomorrow, it's going to be hard to slot you in.</p>` +
      `<p style="margin:18px 0;text-align:center"><a href="#" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">Get on the list</a></p>` +
      notInterested,
  },
  {
    key: 'signup.t1',
    daysLabel: '1 day before',
    daysSort: 1,
    subject: `Last chance to send in your application — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>${eventLine}</strong> is <strong>tomorrow</strong>. This is your last chance to send in your application.</p>` +
      `<p>One tap and you're in.</p>` +
      `<p style="margin:18px 0;text-align:center"><a href="#" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">Apply now</a></p>` +
      notInterested,
  },
];

export const LINEUP_STEPS = [
  {
    key: 'lineup.t21',
    daysLabel: '21 days before',
    daysSort: 21,
    subject: `Congratulations — you're approved for ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>Congratulations.</strong> Trainer Center HB has approved you for <strong>${eventLine}</strong>. We appreciate the partnership and look forward to vending with you.</p>` +
      `<p style="margin:18px 0 8px;font-weight:700">Logistics:</p>` +
      `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li>We provide a <strong>6-foot table</strong></li><li>We provide a <strong>black table cloth</strong> (free)</li><li>Just bring the product you want to sell</li><li>Have cash on hand for exchanges</li></ul>` +
      `<p>Next week we'll post for the event officially and kick off the 2-week promotion sprint.</p>` +
      cantMakeIt,
  },
  {
    key: 'lineup.t14',
    daysLabel: '14 days before',
    daysSort: 14,
    subject: `Critical — promote ${EXAMPLE.eventTitle} on Instagram`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p>Two weeks out from <strong>${eventLine}</strong>. Trainer Center HB has posted on Instagram. Now we need you.</p>` +
      `<p><strong>This is part of the arrangement for a free table.</strong> Find our pinned post on <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a> and:</p>` +
      `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Send it as a DM</strong> to 5–10 people who'd be interested</li><li><strong>Repost it</strong> to your own IG (story or grid)</li><li><strong>Like, comment, and save</strong> the post on our page</li><li>Tap the <strong>reminder bell</strong> on the post so IG pushes it to you and your audience</li></ul>` +
      `<p>Why this matters for <em>you</em>: less engagement on our post means fewer customers walking in your direction. <strong>Fewer customers means less money for you.</strong></p>` +
      `<p>This is your day. Your sales. Your relationships. We're giving you the table — help us pack the room.</p>` +
      cantMakeIt,
  },
  {
    key: 'lineup.t7',
    daysLabel: '7 days before',
    daysSort: 7,
    subject: `One week to ${EXAMPLE.eventTitle} — have you promoted yet?`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>${eventLine}</strong> is one week from today.</p>` +
      `<p>If you haven't yet engaged with our pinned post on <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a>, today's the day. Repost, DM 5–10 people, like, comment, save.</p>` +
      `<p>If you already did — bonus push: do it again. The closer we get, the more traction matters.</p>` +
      cantMakeIt,
  },
  {
    key: 'lineup.t3',
    daysLabel: '3 days before',
    daysSort: 3,
    subject: `3 days out — your ${EXAMPLE.eventTitle} checklist`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>${eventLine}</strong> is in 3 days. Here's your prep checklist.</p>` +
      `<p style="margin:18px 0 8px;font-weight:700">Before event day:</p>` +
      `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Make your own IG QR code</strong> so customers can follow you on the spot</li><li>One last Instagram push — repost, DM, comment on our pinned post</li><li>Have <strong>cash on hand</strong> for exchanges</li><li>Pack the product you want to sell + your QR sign</li></ul>` +
      `<p style="margin:18px 0 8px;font-weight:700">During the event:</p>` +
      `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Take photos and videos</strong> we can post on the Trainer Center HB website — tag you and your business</li><li><strong>Keep cash out of frame</strong> in those photos — focus on the products, the relationships, the families and youth having fun</li><li>Your own personal content can include whatever you want, this is just for the public-facing recap on our site</li></ul>` +
      `<p>This is the push window. Let's pack the room.</p>` +
      cantMakeIt,
  },
  {
    key: 'lineup.t2',
    daysLabel: '2 days before',
    daysSort: 2,
    subject: `2 days out — logistics for ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>${eventLine}</strong> is in 2 days.</p>` +
      `<p>Your confirmed time slot: <strong>${EXAMPLE.vendorTimes}</strong>. 6-foot table and black cloth provided. Just bring your product, your QR code, and cash for exchanges.</p>` +
      `<p>Address: 4911 Warner Ave #210, Huntington Beach, CA 92649.</p>` +
      cantMakeIt,
  },
  {
    key: 'lineup.t1',
    daysLabel: '1 day before',
    daysSort: 1,
    subject: `Tomorrow! ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>${eventLine}</strong> is tomorrow.</p>` +
      `<p>Final reminders:</p>` +
      `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Arrive 30 minutes early</strong> to set up</li><li>4911 Warner Ave #210, Huntington Beach, CA 92649</li><li>Park anywhere in the lot</li><li>One last IG push — repost or story our pinned post if you haven't yet</li><li>Don't forget your IG QR code and cash for exchanges</li></ul>` +
      cantMakeIt,
  },
  {
    key: 'lineup.t0',
    daysLabel: 'Day of — morning',
    daysSort: 0,
    subject: `Today's the day — ${EXAMPLE.eventTitle}`,
    html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
      `<p><strong>Today's the day.</strong> ${eventLine}.</p>` +
      `<p>See you at the shop. Drive safe, bring water, take photos for the recap.</p>`,
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
          `<p>Your vendor profile is in. The Trainer Center HB team will personally review it before approving you. Once approved, you can apply for any upcoming TC's Beach City Trade Night in two clicks from your dashboard.</p>` +
          `<p><strong>Cadence:</strong> last Friday of every month at the shop.</p>` +
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
          `<p>You're in! You can vote for your favorite vendors at any future TC's Beach City Trade Night. Voting opens at the shop on event day — just tap <strong>Review Vendors</strong> on the Vendors page when you're here.</p>` +
          `<p><strong>Cadence:</strong> last Friday of every month.</p>` +
          `<p>We'll send you a reminder a few days before the next one. No spam, no list-selling — just shop news.</p>`,
      },
    ],
  },
  {
    trigger: 'Trainer Center HB approves a vendor profile',
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
          `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:6px;margin:0 0 20px"><p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#92400e;letter-spacing:0.04em">YOU'RE NOT DONE YET</p><p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5">Being approved as a partner does <strong>not</strong> put you on a TC's Beach City Trade Night automatically. You still need to pick which dates you want to be at.</p></div>` +
          `<p style="margin:0 0 12px;font-weight:700">Each TC's Beach City Trade Night requires a quick per-event sign-up:</p>` +
          `<ol style="margin:0;padding-left:20px;color:#444;font-size:14px;line-height:1.7"><li>Open your dashboard</li><li>Pick the dates you want</li><li>Trainer Center HB confirms each one within a day or two</li></ol>`,
      },
    ],
  },
  {
    trigger: 'Vendor applies for a TC\'s Beach City Trade Night',
    triggerLabel: 'New event application',
    description: 'An approved vendor applies for a specific event from their dashboard.',
    emails: [
      {
        key: 'application_received.vendor',
        audienceLabel: 'To the vendor',
        audienceColor: '#16a34a',
        subject: `Got your application for ${EXAMPLE.dateStr}`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p><p>We got your interest in vending on <strong>${EXAMPLE.dateStr}</strong> for <strong>${EXAMPLE.eventTitle}</strong>. Trainer Center HB will confirm your spot soon.</p>`,
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
    trigger: 'Trainer Center HB approves an application',
    triggerLabel: 'Application approved',
    description: 'Staff approves a vendor application for a specific event.',
    emails: [
      {
        key: 'application_decided.approved',
        audienceLabel: 'To the vendor',
        audienceColor: '#16a34a',
        subject: `You're in for ${EXAMPLE.dateStr}`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
          `<p>Trainer Center HB approved your application for <strong>${EXAMPLE.eventTitle}</strong> on <strong>${EXAMPLE.dateStr}</strong> from <strong>${EXAMPLE.vendorTimes}</strong>.</p>` +
          `<p>Bring your inventory, your energy, and your A-game. When you arrive on event day, log in and tap <strong>Check in</strong> on your dashboard. After the event you can come back and upload photos and a clip from your table — those go on our public Vendors page.</p>` +
          `<div style="background:#fff0f0;border-left:4px solid #C8102E;padding:14px 18px;border-radius:6px;margin:18px 0"><p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#C8102E;letter-spacing:0.04em">PROMOTE YOUR TABLE</p><p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5">Your logo and socials are live on the public lineup page. Share the link with your community to drive traffic to your table that day.</p></div>`,
      },
    ],
  },
  {
    trigger: 'Trainer Center HB declines an application',
    triggerLabel: 'Application declined',
    description: 'Staff declines a vendor application for a specific event.',
    emails: [
      {
        key: 'application_decided.declined',
        audienceLabel: 'To the vendor',
        audienceColor: '#9ca3af',
        subject: `About your TC's Beach City Trade Night application`,
        html: `<p>Hi ${EXAMPLE.vendorName},</p>` +
          `<p>Thanks for applying for <strong>${EXAMPLE.eventTitle}</strong> on <strong>${EXAMPLE.dateStr}</strong>. We aren't able to accommodate you this time.</p>` +
          `<p>You're welcome to apply for future dates. We appreciate your interest in Trainer Center HB.</p>`,
      },
    ],
  },
  {
    trigger: 'Staff cancels a TC\'s Beach City Trade Night',
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
          `<p>The next TC's Beach City Trade Night is on the calendar. We'll see you there.</p>`,
      },
    ],
  },
];
