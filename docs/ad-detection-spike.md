# Ad detection: feasibility spike

Roadmap item: "Feasibility spike: on-device detection (repeated-segment fingerprinting per show, transcript
keywords, chapter hints). Written findings + decision."

Run on 2026-11-12 against the four shows in the owner's library. Scripts are in
[`ad-detection-spike/`](ad-detection-spike/) (Python 3, `numpy`, `scipy`, `faster-whisper`, `ffmpeg`).

## Decision

**Do not build zero-touch automatic detection. Build "mark once, skip everywhere":**

1. Fingerprint the ranges the listener has already marked with **Mark ad** (already shipped).
2. Find the same audio in other episodes of the show and skip it there, with the existing "Skipped an ad / Undo" notice.
3. Also **suggest** clips that repeat across a show's episodes ("this 35 s clip is in 3 episodes: skip it?"). The
   listener confirms; nothing is skipped on a guess.

Why: repeated-segment matching is cheap and precise, but it cannot tell an ad from a jingle, and it cannot catch ads
that differ every episode. A human label fixes the first problem and the listener's own marks cover the shows where the
ads do repeat. Transcript keywords are too heavy and too unreliable to be the main method.

## What was tested

Sample: 3 recent episodes each of **Rotten Mango** (Simplecast) and **ShxtsNGigs** (Acast), first ~27 minutes of each
(the first 25 MB, fetched with an HTTP Range request). Small, so read the numbers as indications, not statistics.
I judged what each segment is from a transcript, not by listening.

### 1. Chapter hints: no help for this library

Of the four feeds (1,159 episodes) **none** publish `podcast:chapters` or `podcast:transcript`. Chapter-based skipping
(already shipped, opt-in) only works for shows that publish "Ad"/"Sponsor" chapters; here it never triggers.

### 2. Repeated-segment fingerprinting (spectral-peak landmark hashes, Shazam style)

| Pair | Repeated audio found | What it actually is |
| --- | --- | --- |
| ShxtsNGigs, any two of 3 episodes | 0:01–0:36 identical, ~1,900 votes | **An ad** (a phone-company spot) in the same pre-roll slot every episode |
| Rotten Mango 0 vs 1 | 4:29–4:46 vs 11:33–11:50 (17 s, 272 votes) | A **music stinger** (transcribed "MUSIC PLAYING"), not an ad |
| Rotten Mango 0 vs 1 / 2 | 14:06–14:15 vs 23:22 / 15:31 (8 s, ~25 votes) | Weak match, not an ad |
| Rotten Mango, the ads | **not found** | Openings differ per episode: a 58 s BetterHelp read, no ad, a 9 s debt-solutions spot |
| Rotten Mango vs ShxtsNGigs (control) | 0 matches | No false positives across different shows |

- Cost on a laptop: decode ~2 s + fingerprint ~2 s per 27 min of audio. Memory is small. A Java port (MediaExtractor +
  MediaCodec to 11 kHz mono PCM, a small FFT, hash matching) should land well under a minute per hour of audio on a phone.
  **That is an estimate; I did not measure it on the phone.**
- Strong where an identical ad repeats (dynamically inserted spots, sponsor reads reused across episodes).
- Blind to ads that differ every episode, and it flags repeated non-ads (jingles, stingers, intros). So it needs a
  human label or a confirmation step.

### 3. Transcript keywords (speech-to-text, `tiny.en`, CPU, int8)

- Speed on the laptop: 27 min of audio in 73 to 95 s (17 to 22x real time). On a phone, assume several times slower
  (**unmeasured**): likely 10+ minutes of CPU per hour of audio, plus a model download. Heavy for battery; it would have
  to run on downloaded episodes while charging.
- Caught: the BetterHelp read ("This is a paid ad by BetterHelp", "Sign up and get 10% off at...").
- Missed: the 35 s phone-company spot and the 9 s debt-solutions spot, which contain no promo-code style wording.
- Boundaries are fuzzy (where the ad ends and the show resumes) and the tiny model mishears names ("Rotten" became "ratten").
- Useful as a *secondary* signal later (a disclosure phrase near a suggested clip), not as the primary method.

### 4. Dynamic ad insertion

One probe: the same Acast episode requested three times (two user agents) returned identical bytes. Inconclusive, not
evidence either way. Rotten Mango's ads clearly vary by episode, which matches per-episode sponsorship or insertion.

## Build plan (the roadmap's "implement" item)

Phase 1, marked-ad matching, downloaded episodes
- Java: decode a downloaded file to 11 kHz mono PCM, compute landmark hashes (`docs/ad-detection-spike/fp.py` is the
  reference), store hashes per episode (or just per marked clip plus a rolling window).
- When the listener marks an ad, store its fingerprint under the show. Scan the show's other downloaded episodes (while
  charging, in a WorkManager job) and write matches into the existing per-episode marked ranges, flagged "auto".
- Show them in the existing "Marked ads" list so they can be removed; keep the Undo notice.

Phase 2, pre-roll on streamed episodes
- Pre-roll ads sit in the first minutes (about 3 MB at 128 kbps). Range-fetch that much before playback and match it
  against the show's known clips, so streaming works without a full download.

Phase 3, suggestions
- Cross-match a show's downloaded episodes and offer repeated clips of 20 s or more as "skip this?" prompts. Ignore short
  repeats (stingers) and require the same clip in 2 or more episodes.

Risks and limits
- A wrong skip hides real content: only skip clips the listener confirmed or marked; keep Undo; cap skip length.
- Ads that change every episode will not be caught. That needs the listener to keep marking, or a transcript signal.
- A re-encoded or re-stitched copy of the same ad can lower match strength: keep the vote threshold conservative.

## Not done / open questions

- Only 2 shows and ~27 minutes per episode. Mid-rolls deeper in long episodes (ShxtsNGigs runs 70 to 95 min) were not examined.
- The phone-side speed of fingerprinting and transcription is unmeasured.
- No listening test: segment types are judged from transcripts.
