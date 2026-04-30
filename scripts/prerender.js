#!/usr/bin/env node
/**
 * Prerender script for Trainer Center HB.
 * Generates static HTML files for each route with unique meta tags,
 * OG tags, and noscript content so crawlers see real content.
 *
 * Run after `npm run build`: node scripts/prerender.js
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const BASE_URL = 'https://pokemontrainercenter.com';

// Load blog data to generate blog post pages
let BLOG_DATA = [];
try {
  const blogSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'blogData.js'), 'utf-8');
  // Extract the array by evaluating it (safe since we control the file)
  const match = blogSrc.match(/const BLOG_DATA = (\[[\s\S]*\]);/);
  if (match) {
    BLOG_DATA = eval(match[1]);
  }
} catch (e) {
  console.log('[Prerender] Could not load blogData.js:', e.message);
}

const ROUTES = [
  {
    slug: '',
    title: "Trainer Center HB | California's Only Pokemon-Exclusive Store | Huntington Beach",
    description: "California's only Pokemon-exclusive store. Not a TCG shop. Everything is Pokemon. Cards, collectibles, grading, events, and community. Located in Huntington Beach, CA.",
    keywords: "Pokemon store California, Pokemon only store, only Pokemon store California, Pokemon exclusive store, best Pokemon store California, Pokemon store Orange County, Pokemon store Huntington Beach",
    h1: "Trainer Center HB - California's Only Pokemon-Exclusive Store",
    body: "The only store in California dedicated entirely to Pokemon. Not a generic TCG shop. Cards from every era, collectibles, PSA grading services, weekly trade nights, community events, consultations, buy and sell. Located at 4911 Warner Ave #210, Huntington Beach, CA 92649. Phone: (714) 951-9100."
  },
  {
    slug: 'calendar',
    title: "Events & Calendar | Trainer Center HB | Pokemon Events Huntington Beach",
    description: "Weekly Pokemon events in Huntington Beach. Trade Night every Friday, Game Day, Community Day, Painting Day, private consultations, and monthly Vendor Day. All at Trainer Center HB.",
    keywords: "Pokemon trade night, Pokemon events Orange County, Pokemon tournament Huntington Beach, Pokemon community events, card trading events",
    h1: "Trainer Center HB Events Calendar",
    body: "Weekly events: Sunday - Painting Day. Tuesday - Masterset with Larry. Wednesday - Game Day with Seth. Thursday - Private Consultation with Chef. Friday - Trade Night. Saturday - Community Day. Last Friday of every month - Vendor Day (free for vendors). Located at 4911 Warner Ave #210, Huntington Beach, CA 92649."
  },
  {
    slug: 'consultation',
    title: "Private Pokemon Card Consultation | Trainer Center HB | Huntington Beach",
    description: "Free one-on-one Pokemon card consultation with the shop owner. Appraisals, collecting strategies, investing advice, and TCG coaching. Thursdays at Trainer Center HB, Huntington Beach.",
    keywords: "Pokemon card appraisal, Pokemon collection consultation, Pokemon card value, Pokemon investing, Pokemon TCG coaching, card grading advice",
    h1: "Private Pokemon Card Consultation at Trainer Center HB",
    body: "Schedule a free private Pokemon card consultation with Chef at Trainer Center HB in Huntington Beach, California. Whether you found an old binder in the attic or you have been collecting for years, Chef will sit down with you one-on-one and walk through what you have. This is not a sales pitch. The goal is to educate you so you know what your collection is actually worth and you do not get taken advantage of. We cover card identification from Base Set shadowless to modern illustration rares, real-time market value using TCGplayer and eBay sold listings, grading advice on which cards are actually worth the PSA fee, best timing to buy or sell based on current Pokemon market trends, Pokemon history across the different eras and rare prints, and evaluation of vintage collections including sealed product and Japanese imports. What to bring: everything. Cards in sleeves, toploaders, or even a shoebox are fine. Do not clean, polish, or try to straighten corners on vintage cards before the appointment. Leave them in original condition and bring any paperwork or original packaging. Consultations run 30 to 60 minutes and are private, with your cards staying on the counter in front of you the entire time. Most common question: is it free? Yes. Chef offers consultations at no cost because the goal is long-term relationships with collectors. If we happen to buy cards from you that same visit, that is fine, but there is no pressure and no fee either way. Thursdays by appointment. Contact us at (714) 951-9100 or Trainercenter.pokemon@gmail.com to schedule."
  },
  {
    slug: 'grading',
    title: "PSA Grading Services | Trainer Center HB | Pokemon Card Grading Huntington Beach",
    description: "We help you grade your Pokemon cards through PSA. We evaluate condition, handle the submission, and get your cards back graded and protected. Located in Huntington Beach, CA.",
    keywords: "PSA grading Pokemon, Pokemon card grading, PSA submission, grade Pokemon cards, Pokemon card authentication, card grading Orange County",
    h1: "PSA Pokemon Card Grading Services at Trainer Center HB",
    body: "Pokemon card grading through PSA handled end-to-end at Trainer Center HB in Huntington Beach, California. You bring your cards in. We evaluate them with you at the counter. We handle the entire PSA submission on our shop account, so you skip the signup, the bulk minimums, the shipping supplies, and the insurance hassle. You get your cards back graded and encapsulated, ready for your collection or the aftermarket. PSA pricing tiers as of early 2026: Value Bulk at $25 per card with roughly 95 day turnaround and $500 max value, Value at $33 with 75 day turnaround, Value Plus at $50 with 45 day turnaround and $1000 max value, Value Max at $65 with 35 day turnaround and $1500 max value, Regular at $80 with 25 day turnaround, Express at $160 with 10 day turnaround and $2999 max value, and Super Express at $300 with 5 day turnaround and $4999 max value. Prices are set by PSA and subject to change. Which Pokemon cards are actually worth grading? Not most of them. Grading fees plus shipping mean the math only works when the expected graded value substantially exceeds the raw price. Cards that make sense are vintage holographics from Base Set, Jungle, Fossil, Neo and early English sets, modern chase cards like alt arts and special illustration rares, error cards, first editions, and anything with clean centering and surfaces. Cards that usually should not get graded include non-holo commons, recent mass-produced promos, cards with visible whitening or print lines, and anything where the raw market price is under about fifteen dollars. PSA grades four things on every card: centering, corners, edges, and surface. Your final grade is capped by the weakest of those four. A perfect surface cannot save off-center borders and sharp corners cannot save print line damage. PSA 10 is Gem Mint, essentially perfect. PSA 9 is Mint with one minor flaw. PSA 8 is Near Mint-Mint with light visible wear. PSA 7 and below step down from there with increasingly obvious flaws. Common questions. Do I need a PSA account? No, we submit on our shop account. How long does it take? Depends on tier, typically 5 to 95 days. Can I watch you package my submission? Yes, everything happens in front of you. What if a card grades lower than expected? We give you honest assessments before submitting so you never send cards we do not believe in. Do you grade Japanese Pokemon cards? Yes, PSA grades Japanese on the same scale. Located at 4911 Warner Ave #210, Huntington Beach, CA 92649. Call (714) 951-9100."
  },
  {
    slug: 'buy-sell',
    title: "Buy & Sell Pokemon Cards | Trainer Center HB | Huntington Beach",
    description: "Buy and sell Pokemon cards at Trainer Center HB. We buy collections, offer consignment, and sell singles, sealed product, and PSA graded cards. Huntington Beach, CA.",
    keywords: "buy Pokemon cards, sell Pokemon cards, Pokemon card consignment, Pokemon singles, sealed Pokemon product, PSA slabs, Pokemon cards Orange County",
    h1: "Buy and Sell Pokemon Cards at Trainer Center HB",
    body: "Buy and sell Pokemon cards at Trainer Center HB in Huntington Beach, California. We buy entire Pokemon collections outright, offer consignment for graded cards and higher-end singles, and sell from our own inventory of singles, sealed product, and PSA graded slabs. How selling works: you walk in with your cards and we sit at the counter together. Chef goes through the collection card by card for anything meaningful and bulks the rest into obvious lots. You watch the whole process. Nothing goes into a back room. We price each meaningful card or lot using live TCGplayer market data, eBay sold comps, and current Pokemon market movement. The offer is a single number you can take or leave. Cash or Zelle same visit. No processing fees, no shipping risk, no waiting for a check. What we actively buy: vintage cards from Base Set through Neo, especially holographics and first editions, sealed product from any era including booster boxes Elite Trainer Boxes Japanese promos and older tins, modern chase cards like alt arts special illustration rares and secret rares, graded cards outright or on consignment depending on the card, and Pokemon plushies figures and vintage Japanese merchandise. If we see cards where we think you are better off holding rather than selling into weakness, we tell you. Our job during a buy is not to extract every dollar but to give a fair offer on what you want to part with and honest guidance on what you should keep. Consignment is the right path when you have graded cards or high-end singles and you want to capture more of the sale price than an outright buy would pay. We list your items in the shop and online where collectors see them. When they sell you get paid minus a small consignment fee. You skip eBay fees, shipping, and risk from dishonest buyers. The tradeoff is time. Outright buys put cash in your hand today. Consignment gets you a higher number but takes days to weeks depending on the card. Located at 4911 Warner Ave #210, Huntington Beach, CA 92649. Call (714) 951-9100 to set up a visit or arrange a consignment agreement."
  },
  {
    slug: 'blog',
    title: "Blog | Trainer Center HB | Pokemon Card Tips, Guides & News",
    description: "Tips, guides, and insights for Pokemon card collectors. From grading advice to collecting strategies, learn from Huntington Beach's only Pokemon-exclusive card store.",
    keywords: "Pokemon card blog, Pokemon collecting tips, Pokemon grading guide, Pokemon card value, Pokemon TCG tips",
    h1: "Trainer Center HB Blog - Pokemon Card Tips & Guides",
    body: "Expert Pokemon card content from California's only Pokemon-exclusive store. Guides on grading, collecting, pricing, fake card detection, and more."
  },
  {
    slug: 'vendors',
    title: "Vendor Day | Trainer Center HB | Apply to Vend Pokemon Cards in Huntington Beach",
    description: "Set up a table at Trainer Center HB's monthly Vendor Day. Last Friday of every month. Apply online to vend Pokemon singles, sealed, slabs, vintage, and Japanese imports. Huntington Beach, CA.",
    keywords: "Pokemon vendor, vendor day Pokemon, sell Pokemon cards Orange County, Pokemon swap meet California, vendor application Pokemon shop, Pokemon table vendor Huntington Beach",
    h1: "Vendor Day at Trainer Center HB",
    body: "Vendor Day at Trainer Center HB in Huntington Beach happens the last Friday of every month. Pokemon vendors set up tables and bring their singles, sealed product, slabs, vintage cards, and Japanese imports to trade and sell with collectors and walk-in customers. Apply once and return every month with a quick re-apply. After each event, attending vendors share photos and short clips from their tables, featured directly on this page. Approved vendors check in on event day and the community sees who is bringing what. Located at 4911 Warner Ave #210, Huntington Beach, CA 92649. Call (714) 951-9100 to ask about Vendor Day, or apply to vend through this page."
  }
];

// Add blog post routes dynamically
const publishedBlogs = BLOG_DATA.filter(b => b.published);
for (const blog of publishedBlogs) {
  // Extract first paragraph as description
  const firstP = blog.content.find(c => c.type === 'p');
  const desc = firstP ? firstP.text.replace(/<[^>]+>/g, '').slice(0, 155) + '...' : blog.title;

  // Extract all text for noscript body
  const bodyText = blog.content
    .filter(c => c.type === 'p')
    .slice(0, 3)
    .map(c => c.text.replace(/<[^>]+>/g, ''))
    .join(' ');

  ROUTES.push({
    slug: `blog/${blog.slug}`,
    title: `${blog.title} | Trainer Center HB Blog`,
    description: desc,
    keywords: `Pokemon cards, ${blog.title.toLowerCase()}, Trainer Center HB, Pokemon collecting`,
    h1: blog.title,
    body: bodyText || blog.title
  });
}

// Build a site-wide nav block of every route. Injected into <noscript> on
// every prerendered page so crawlers can walk from any page to any other.
// Without this, a low-authority new site's homepage looks like an empty
// shell to Googlebot and inner pages stay "Discovered, not indexed."
function buildSiteNav() {
  const links = ROUTES.map((r) => {
    const url = r.slug ? `${BASE_URL}/${r.slug}` : `${BASE_URL}/`;
    return `<a href="${url}">${r.h1}</a>`;
  });
  return `<nav aria-label="Site map">${links.join(' · ')}</nav>`;
}

function prerender() {
  const template = fs.readFileSync(path.join(BUILD_DIR, 'index.html'), 'utf-8');
  const siteNav = buildSiteNav();
  let count = 0;

  for (const route of ROUTES) {
    let html = template;
    const url = route.slug ? `${BASE_URL}/${route.slug}` : BASE_URL;

    // Replace title
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`);

    // Replace meta description
    html = html.replace(
      /<meta name="description" content="[^"]*"/,
      `<meta name="description" content="${route.description}"`
    );

    // Replace meta keywords
    html = html.replace(
      /<meta name="keywords" content="[^"]*"/,
      `<meta name="keywords" content="${route.keywords}"`
    );

    // Replace canonical
    html = html.replace(
      /<link rel="canonical" href="[^"]*"/,
      `<link rel="canonical" href="${url}"`
    );

    // Replace OG tags
    html = html.replace(
      /<meta property="og:title" content="[^"]*"/,
      `<meta property="og:title" content="${route.title}"`
    );
    html = html.replace(
      /<meta property="og:description" content="[^"]*"/,
      `<meta property="og:description" content="${route.description}"`
    );
    html = html.replace(
      /<meta property="og:url" content="[^"]*"/,
      `<meta property="og:url" content="${url}"`
    );

    // Replace Twitter tags
    html = html.replace(
      /<meta name="twitter:title" content="[^"]*"/,
      `<meta name="twitter:title" content="${route.title}"`
    );
    html = html.replace(
      /<meta name="twitter:description" content="[^"]*"/,
      `<meta name="twitter:description" content="${route.description}"`
    );

    // Replace noscript content (includes site nav so crawlers can discover
    // every page from every page)
    html = html.replace(
      /<noscript>[\s\S]*?<\/noscript>/,
      `<noscript>\n      <h1>${route.h1}</h1>\n      <p>${route.body}</p>\n      ${siteNav}\n    </noscript>`
    );

    // Write file
    if (route.slug === '') {
      // Homepage - overwrite index.html
      fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html);
    } else {
      // Inner pages - write as slug.html
      const slugParts = route.slug.split('/');
      if (slugParts.length > 1) {
        // Nested route like blog/slug
        const dir = path.join(BUILD_DIR, slugParts[0]);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${slugParts[1]}.html`), html);
      } else {
        fs.writeFileSync(path.join(BUILD_DIR, `${route.slug}.html`), html);
      }
    }
    count++;
    console.log(`[Prerender] ${url}`);
  }

  console.log(`\n[Prerender] Generated ${count} pages.`);
}

prerender();
