# Trainer Center "Photo Check" Reel — Template

A vertical (1080×1920) IG Reel that frames a set of cards as a **Pokémon Snap "Photo Check"**:
opens in Prof. Oak's lab → a beat-synced photo collage → 4 hero card reveals with star
ratings → climax on the music drop → **Come visit the shop** CTA.

Everything is rendered deterministically from `render.html` (a `render(t)` function), captured
frame-by-frame, then muxed with a built audio mix. **No editing software needed.**

## Make a new reel (the usual case: a new card set / "level")

1. **Drop the photos.** Put your card photos (any format — HEIC/JPG/PNG, any names) in `raw/`.
   You want **16** photos. They get auto-converted + numbered `display/card_01..16.jpg`.

2. **Edit the CONFIG block** at the top of `render.html`:
   - `theme`      — background theme: `"gallery"` (warm gold, matches Trainer Gallery borders)
     or `"space"` (deep blue starfield, **saved for the Mew reel**). Add more in the `THEMES`
     dict just below CONFIG — each sets the stage gradient, grid color, star color, lab tint.
   - `levelName`  — the big level/set name (e.g. `"TRAINER GALLERY"`, `"151 MASTERS"`).
   - `courseTag`  — small tag under it (e.g. `"★ COURSE 02 ★"`).
   - `heroes`     — the 4 cards to spotlight, **in reveal order**. The **last** one lands on the
     music drop (make it the grail). Each: `{file, stars, points, name, reaction}` where
     `file` is the `display/card_NN` number. Reaction **voices are positional**:
     hero 1 = "Ooh!", 2 = "Wonderful!", 3 = "Wow!", 4 = "Perfect!" — so write the `reaction`
     text to match that vibe.
   - `cta` / `loc` — the shop call-to-action + location/handle.

3. **Build it:**  `./make.sh my_reel.mp4`
   (converts photos → builds audio → renders 960 frames → muxes the mp4 → opens it)

That's it. ~90 seconds.

## Structure / timing (120 BPM, 0.5s beat)

| beat            | time      | what                                                            |
|-----------------|-----------|----------------------------------------------------------------|
| intro           | 0–4s      | lab establishing shot + level title + "Welcome back!"          |
| collage         | 4–7.75s   | 16 photos stamp in on **eighth notes** (every 0.25s)           |
| heroes          | 9.5–23s   | 4 reveals @ 9.5 / 14 / 18.5 / 23, each with stars + points     |
| **drop**        | 23s       | last hero slams in on the music's energy drop + "Perfect!"     |
| WELL DONE       | 26s       | Oak's praise stamp                                             |
| shop CTA        | 28.4–32s  | Trainer Center logo + "Come visit the shop!"                   |

To retime, the anchors live in both `render.html` (visuals) and `build_audio.js` (sound) —
keep them in sync. Key constants: `STAMP[]` (photo times), `HSTART`/`HSTEP` (hero times),
`DROP`, `CDONE`, `TOTAL`/`DUR`.

## Files

- `render.html`     — the whole animation; **CONFIG block at top is the only thing you edit normally**
- `capture.js`      — Playwright frame capture (`DUR` = length in seconds)
- `build_audio.js`  — builds `audio_out/mix.mp3` from the music bed + Oak voices + SFX
- `make.sh`         — one-shot build
- `audio_out/`      — Oak voice clips (`oak_*.wav`), `music.mp3` (trimmed song), SFX, final `mix.mp3`
- `cards/` `display/` `raw/` — source / display-size / drop-in card photos
- `tc_logo.png` `lab_disp.jpg` — brand logo + graded lab backdrop

## Audio assets

- **Music**: `music.mp3` is the song trimmed so its energy drop sits at 23s. To swap songs,
  re-trim into `audio_out/music.mp3` (32s, drop at ~23s) — see the `ffmpeg -ss .. -t 32` recipe
  used for the current track (Pokémon Snap Guitar Medley).
- **Oak voices**: `oak_welcome / oh / wonderful / wow / perfect / welldone .wav` — already
  reverbed. The 4 hero reactions use oh / wonderful / wow / perfect positionally.
