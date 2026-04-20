#!/usr/bin/env node
/**
 * Prerender script for Trainer Center.
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
    title: "Trainer Center | California's Only Pokemon-Exclusive Store | Huntington Beach",
    description: "California's only Pokemon-exclusive store. Not a TCG shop. Everything is Pokemon. Cards, collectibles, grading, events, and community. Located in Huntington Beach, CA.",
    keywords: "Pokemon store California, Pokemon only store, only Pokemon store California, Pokemon exclusive store, best Pokemon store California, Pokemon store Orange County, Pokemon store Huntington Beach",
    h1: "Trainer Center - California's Only Pokemon-Exclusive Store",
    body: "The only store in California dedicated entirely to Pokemon. Not a generic TCG shop. Cards from every era, collectibles, PSA grading services, weekly trade nights, community events, consultations, buy and sell. Located at 4911 Warner Ave #210, Huntington Beach, CA 92649. Phone: (714) 951-9100."
  },
  {
    slug: 'calendar',
    title: "Events & Calendar | Trainer Center | Pokemon Events Huntington Beach",
    description: "Weekly Pokemon events in Huntington Beach. Trade Night every Friday, Game Day, Community Day, Painting Day, private consultations, and monthly Vendor Day. All at Trainer Center.",
    keywords: "Pokemon trade night, Pokemon events Orange County, Pokemon tournament Huntington Beach, Pokemon community events, card trading events",
    h1: "Trainer Center Events Calendar",
    body: "Weekly events: Sunday - Painting Day. Tuesday - Masterset with Larry. Wednesday - Game Day with Seth. Thursday - Private Consultation with Chef. Friday - Trade Night. Saturday - Community Day. Last Friday of every month - Vendor Day (free for vendors). Located at 4911 Warner Ave #210, Huntington Beach, CA 92649."
  },
  {
    slug: 'consultation',
    title: "Private Pokemon Card Consultation | Trainer Center | Huntington Beach",
    description: "Free one-on-one Pokemon card consultation with the shop owner. Appraisals, collecting strategies, investing advice, and TCG coaching. Thursdays at Trainer Center, Huntington Beach.",
    keywords: "Pokemon card appraisal, Pokemon collection consultation, Pokemon card value, Pokemon investing, Pokemon TCG coaching, card grading advice",
    h1: "Private Pokemon Card Consultation at Trainer Center",
    body: "Schedule a private consultation with Chef on Thursdays. Get appraisals, collecting strategies, investing advice, or learn to play the Pokemon TCG. Contact us at (714) 951-9100 or Trainercenter.pokemon@gmail.com."
  },
  {
    slug: 'grading',
    title: "PSA Grading Services | Trainer Center | Pokemon Card Grading Huntington Beach",
    description: "We help you grade your Pokemon cards through PSA. We evaluate condition, handle the submission, and get your cards back graded and protected. Located in Huntington Beach, CA.",
    keywords: "PSA grading Pokemon, Pokemon card grading, PSA submission, grade Pokemon cards, Pokemon card authentication, card grading Orange County",
    h1: "PSA Pokemon Card Grading Services at Trainer Center",
    body: "We evaluate your Pokemon cards, handle the PSA submission process, and get them back to you graded and protected. PSA pricing tiers from $25 (Value Bulk) to $300 (Super Express). Located at 4911 Warner Ave #210, Huntington Beach, CA 92649."
  },
  {
    slug: 'buy-sell',
    title: "Buy & Sell Pokemon Cards | Trainer Center | Huntington Beach",
    description: "Buy and sell Pokemon cards at Trainer Center. We buy collections, offer consignment, and sell singles, sealed product, and PSA graded cards. Huntington Beach, CA.",
    keywords: "buy Pokemon cards, sell Pokemon cards, Pokemon card consignment, Pokemon singles, sealed Pokemon product, PSA slabs, Pokemon cards Orange County",
    h1: "Buy and Sell Pokemon Cards at Trainer Center",
    body: "We buy Pokemon card collections and offer consignment for sellers. Browse our inventory of singles, sealed product, and PSA graded cards. Located at 4911 Warner Ave #210, Huntington Beach, CA 92649. Call (714) 951-9100."
  },
  {
    slug: 'blog',
    title: "Blog | Trainer Center | Pokemon Card Tips, Guides & News",
    description: "Tips, guides, and insights for Pokemon card collectors. From grading advice to collecting strategies, learn from Huntington Beach's only Pokemon-exclusive card store.",
    keywords: "Pokemon card blog, Pokemon collecting tips, Pokemon grading guide, Pokemon card value, Pokemon TCG tips",
    h1: "Trainer Center Blog - Pokemon Card Tips & Guides",
    body: "Expert Pokemon card content from California's only Pokemon-exclusive store. Guides on grading, collecting, pricing, fake card detection, and more."
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
    title: `${blog.title} | Trainer Center Blog`,
    description: desc,
    keywords: `Pokemon cards, ${blog.title.toLowerCase()}, Trainer Center, Pokemon collecting`,
    h1: blog.title,
    body: bodyText || blog.title
  });
}

function prerender() {
  const template = fs.readFileSync(path.join(BUILD_DIR, 'index.html'), 'utf-8');
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

    // Replace noscript content
    html = html.replace(
      /<noscript>[\s\S]*?<\/noscript>/,
      `<noscript>\n      <h1>${route.h1}</h1>\n      <p>${route.body}</p>\n    </noscript>`
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
