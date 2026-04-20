# Trainer Center SEO Strategy

## The Opportunity

ChatGPT, Google, and every AI model confirmed it: **there is no true Pokemon-only brick-and-mortar store in California.** Every "top" result is a mixed TCG shop that happens to carry Pokemon. Frank & Son is a flea market. ProjectCCG is clean but still multi-game. CoreTCG is inventory-heavy but generic.

**Trainer Center IS the Pokemon-only store.** That positioning needs to be everywhere.

## Goal

When someone asks "best Pokemon store in California" or "Pokemon card store Orange County" -- Trainer Center shows up. In Google. In ChatGPT. In Yelp. In Apple Maps. Everywhere.

## Current Problems

- ChatGPT does not surface Trainer Center unless asked by name
- Google Business Profile is thin (few reviews, few photos, weak categories)
- Not listed on major directories (Yelp, Bing Places, Apple Maps, Yellow Pages, etc.)
- No structured data on pokemontrainercenter.com
- No review generation system in place
- Social presence is Instagram-only, no cross-platform

## Phase 1: Foundation (Technical SEO + Schema)

### Website Schema Markup (pokemontrainercenter.com)
- `LocalBusiness` / `Store` structured data
- Name: Trainer Center
- Description: "California's only Pokemon-only card store"
- Address: 4911 Warner Ave #210, Huntington Beach, CA 92649
- Phone: (714) 951-9100
- Email: Trainercenter.pokemon@gmail.com
- Hours: Sun 10-5, Mon Closed, Tue-Thu 12-8, Fri 12-10, Sat 10-8
- Images: logo + store photos
- PriceRange, PaymentAccepted, areaServed (Orange County, SoCal, California)
- Events schema for recurring events (Trade Night, Vendor Day, etc.)
- hasOfferCatalog for services (grading, consultation, buy/sell)

### Meta Tags + Open Graph
- Title: "Trainer Center | California's Pokemon-Only Card Store | Huntington Beach"
- Description: "The only Pokemon-exclusive card store in California. Singles, sealed, grading, trading, and community events. Located in Huntington Beach."
- OG image: logo or store front photo
- Every page needs unique meta

### Google Business Profile Optimization
- Verify listing is fully claimed
- Primary category: "Trading Card Store"
- Secondary categories: "Pokemon Store", "Collectibles Store", "Game Store"
- Upload ALL 31 store photos
- Add logo and cover photo
- Write business description emphasizing POKEMON ONLY
- Add all services: Grading, Consultation, Buy/Sell, Trading Events
- Add products: Pokemon singles, sealed product, PSA slabs, accessories
- Post weekly (can automate via GHL or API)
- Add Q&A: "Do you only sell Pokemon?" -> "Yes, we are Pokemon-exclusive"
- Enable messaging

## Phase 2: Citation Building (Directory Presence)

### Must-Have Directories (consistent NAP everywhere)
- Google Business Profile
- Apple Maps (Apple Business Connect)
- Bing Places
- Yelp
- Facebook Business Page
- Yellow Pages
- BBB
- Foursquare
- MapQuest
- ChamberOfCommerce.com
- Hotfrog
- Manta
- Brownbook
- CitySearch

### Niche/Hobby Directories
- TCGPlayer (store locator)
- Pokemon event locator (if Pokemon Company has one)
- Local HB business directories
- OC business directories
- Harbour Landing shopping center directory

### NAP (must be IDENTICAL everywhere)
```
Trainer Center
4911 Warner Ave #210
Huntington Beach, CA 92649
(714) 951-9100
https://pokemontrainercenter.com
```

## Phase 3: Review Generation (GHL Automation)

### Strategy
- After every Trade Night: automated text to attendees asking for Google review
- After every consultation with Chef: follow-up text with review link
- After every purchase/grading submission: review request
- QR code in-store linking to Google review page
- Staff trained to ask for reviews naturally

### Targets
- Current: unknown (likely < 20 reviews)
- 3 month goal: 50+ reviews
- 6 month goal: 100+ reviews
- Competitor benchmark: ProjectCCG has minimal, CoreTCG ~4.0, Frank & Son 4.7

### GHL Flows
- Trigger: customer visit / event attendance
- Wait: 2 hours
- Send SMS: "Thanks for coming to Trainer Center! If you had a good time, a Google review helps us a lot: [link]"
- If no review after 3 days: follow-up email
- Track who reviewed, don't ask twice

## Phase 4: Content + Social Presence

### Blog SEO (already have 12 blogs queued)
- Each blog targets a long-tail keyword
- Internal linking to services pages
- "Written by Trainer Center, Huntington Beach's Pokemon-only store"

### Social Expansion
- Instagram: @trainercenter.pokemon (active)
- TikTok: short clips of Trade Night, pack openings, rare pulls
- YouTube: grading walkthroughs, collection tours, event recaps
- Facebook: business page with reviews enabled
- Google Business Posts: weekly updates

### Content Calendar
- Monday: Blog post goes live
- Wednesday: Instagram reel (Game Day content)
- Friday: Trade Night recap / preview
- Saturday: Community highlight / customer feature

## Phase 5: AI Visibility (ChatGPT, Perplexity, etc.)

### Why AI can't find Trainer Center
- Not enough web presence (citations, reviews, articles)
- No Wikipedia or major directory mentions
- Website doesn't have enough structured content
- No backlinks from authoritative sources

### How to fix it
- Get mentioned in local press / OC Register / Patch.com
- Get listed on "best card shops in OC" listicle blogs
- Encourage bloggers/YouTubers to mention by name + link
- Reddit presence (r/pokemontcg, r/orangecounty)
- Structured data helps AI models parse the website

## Key Messaging (Use Everywhere)

**Primary:** "California's only Pokemon-exclusive store"
**Secondary:** "Huntington Beach's home for Pokemon cards, grading, and community"
**Differentiator:** "Not a TCG shop. Not a card store that carries Pokemon. A store dedicated entirely to Pokemon. The only one in California."

## Competitor Landscape

| Store | Pokemon Only? | Reviews | Vibe |
|-------|--------------|---------|------|
| Trainer Center | YES | Low | Community-first, Pokemon-only |
| ProjectCCG | No (multi-TCG) | 5.0 (few) | Premium, Apple Store feel |
| CoreTCG | No (multi-TCG) | 4.0 | Inventory-heavy, serious |
| Frank & Son | No (flea market) | 4.7 (many) | Massive, multi-vendor |
| Supreme Card Shop | No (mixed) | 4.6 | Chill collector shop |

**None of them are Pokemon-only. That is the entire play.**

## Tools

- **Go High Level**: Review automation, SMS/email flows, reputation management
- **Google Business Profile**: Photos, posts, Q&A, categories
- **Schema/SEO**: Website structured data (can build into trainercenter app)
- **Netlify**: Already deployed, fast, good for SEO
- **Supabase**: Can store review tracking, customer data for GHL flows
