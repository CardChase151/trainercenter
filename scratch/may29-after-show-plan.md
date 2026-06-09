# After-Show Plan — May 29 Beach City Trade Night

## Final stats
- **38 check-ins** through the door QR
- **32 of 38 (84%)** selected a vendor as their inviter (only 6 said "None")
- **18 voters cast 44 votes** (47% of checkins voted)
- **34 new account signups** captured through QR
- Voting bug from 3:00 PM → 6:45 PM PDT cost ~3.75 hours of votes (~20+ people checked in but couldn't vote during the dead zone)

## Leaderboard 1 — Who Brought the Crowd
| # | Vendor | IG | Guests |
|---|---|---|---|
| 1 | **Otaku's TCG** | @otakustcg | **14** (37% of attendance solo) |
| 2 | Mark Sandoval | @GengarAndSons | 5 |
| 3 | @pokecreedcollection | @Pokecreedcollection | 2 |
| 3 | Jeffrey Tran | @seasidecollects | 2 |
| 3 | Niko Maragos | @vnrtcg | 2 |

## Leaderboard 2 — Favorites (votes)
| # | Vendor | IG | Votes |
|---|---|---|---|
| 1 | **Otaku's TCG** | @otakustcg | 10 |
| 2 | Mark Sandoval | @GengarAndSons | 6 |
| 3 | Lavendertowntradingco | @lavendertowntradingco | 4 |

Otaku's wins both. Top priority for outreach + IG shoutout.

## The Plan

### Today / Tomorrow
1. **Snapshot leaderboards** (this file).
2. **Automated thank-you email to NEW guests** — DONE. 34 sent via Resend.

### This week
3. **Vendor thank-you call wave** — manual, Chase on the phone.
   - Call sheet: `may29-vendor-call-sheet.md` (numbered, alphabetical)
   - Start with top 5: Otaku's, Mark Sandoval, Lavendertown, then top inviters
   - Goal: tighten relationships, lock in for June 26

4. **Native post-event vendor survey** (Supabase-backed).
   - 3-4 questions: how was sales, what would improve it, want a guaranteed table next time, anything else
   - Sent via vendor portal link in a follow-up email
   - Spec: `vendor_event_surveys` table with vendor_id + event_id + responses

### Next week
5. **Vendor review pass — 3-tier rating** (staff-only screen).
   - Love / Neutral / Not-a-fit, per vendor per event
   - Love = auto-invite next event, skip re-application
   - Not-a-fit = quietly drop from outreach
   - Schema: `vendor_ratings` table (vendor_id, event_id, rating, decided_by, notes)

### Backlog
6. **IG recap reel** — Chase to produce. (in progress)

## Sender + Template Notes
- Thank-you email sender: `"Trainer Center HB" <noreply@mysendz.com>` via Resend
- Reply-To: `chef@trainercenter.com`
- BCC: `chef@trainercenter.com`
- Template script saved in `~/Apps/me/emails/drafts/` for reuse each event
- Bug fixes shipped tonight: door-QR timezone (now LA, 1hr grace past midnight) + voting close-time (now LA-correct, was using UTC)
