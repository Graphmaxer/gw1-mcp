# ChatGPT demo recording — shot list

**Status:** drafted 2026-07-31. The submission form blocks on
`Demo recording URL is required`, and asks for a video made in
[Developer Mode](https://platform.openai.com/docs/guides/developer-mode) covering
"all main use cases and tools across all platforms (web, iOS, Android)".

## Why this is not just "record the five test cases"

The five positive cases in `chatgpt-app-submission.json` exercise six tools:
`decode_template`, `get_skill`, `search_skills`, `validate_build`,
`encode_template`, `list_heroes`. They leave **`get_hero` and
`decode_pawned_team` untouched**. Following them alone would submit a recording
that omits two of the eight tools the form asks to see.

Shots 4 and 6 below exist to close that gap.

## How to record it, concretely

### 1. Check this first, before filming anything

**Developer mode is documented as a web feature.** OpenAI's own guide says to
enable it in ChatGPT under **Settings → Security and login → Developer mode**,
then go to **ChatGPT Plugins → "+" → create a developer-mode app** for the remote
MCP server, and it describes the capability as available "on the web".

But the submission form asks for a demo covering **web, iOS and Android**. So the
first question is not how to record — it is whether the developer-mode app is even
reachable from the mobile apps on the same account. Create it, then open ChatGPT on
a phone and look for it before planning three passes. If it is web-only, the
requirement cannot be met as literally stated for an unpublished plugin, and that
is worth saying in the submission notes rather than shipping a video that silently
covers one surface.

Third-party guides place the toggle under Settings → Apps → Advanced settings
instead, and Business/Enterprise workspaces put it behind an admin setting. If it
is not where the official guide says, look there.

### 2. Set up the session

- The connector must be **enabled per chat session** from the tools menu. Do that
  before starting the recording, not on camera.
- Developer mode changes the composer's appearance (an orange border) and disables
  memory for the chat. Both are expected in a dev-mode demo; no need to hide them.
- Start a fresh chat. Some surfaces need a new chat before the tools menu picks up
  a newly added app.

### 3. Record

On Linux, OBS Studio is the reliable choice: window capture on the browser, record
to MP4. GNOME's built-in recorder (Ctrl+Alt+Shift+R) works too, but check its
maximum length setting first — the default cutoff is short enough to truncate a
five-minute take. On a phone, use the OS screen recorder.

Prepare a scratch file with the template code and both pwnd blobs and paste from
it. Do not type a 25-character code on camera, and on mobile send them to yourself
beforehand rather than typing them at all.

Keep the Cloudflare dashboard, Workers logs and anything carrying account
identifiers out of frame.

### 4. One URL, several passes: assemble a single video

The form has one Demo Recording URL field and asks to "record **a** video" covering
all platforms, so the deliverable is one file containing every pass — not a
playlist, and not a folder link a reviewer has to navigate.

The technical wrinkle is orientation: the desktop pass is landscape, the phone
passes are portrait. Concatenating mixed dimensions directly fails, so normalise
everything onto one canvas first and **letterbox** the portrait footage rather than
cropping it — cropping a phone recording cuts off the composer or the response.

Tested end to end with ffmpeg (a 1920x1080 clip and a 1080x2340 clip assembled into
one 1920x1080 file):

```bash
# A title card per platform, in the project's own colours
card() {
  ffmpeg -y -f lavfi -i "color=c=0x17151B:s=1920x1080:r=30:d=2" \
    -vf "drawtext=text='$1':fontcolor=0xF0BB34:fontsize=90:x=(w-text_w)/2:y=(h-text_h)/2" \
    -c:v libx264 -pix_fmt yuv420p "$2"
}
card "Web" t-web.mp4 ; card "iOS" t-ios.mp4 ; card "Android" t-android.mp4

# Normalise every pass to the same canvas, padding instead of cropping
for f in web ios android; do
  ffmpeg -y -i raw-$f.mp4 \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,\
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x17151B,setsar=1,fps=30" \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p n-$f.mp4
done

# Concatenate without re-encoding
printf "file 't-web.mp4'\nfile 'n-web.mp4'\nfile 't-ios.mp4'\nfile 'n-ios.mp4'\nfile 't-android.mp4'\nfile 'n-android.mp4'\n" > list.txt
ffmpeg -y -f concat -safe 0 -i list.txt -c copy final.mp4
```

The `-c copy` on the last step only works because every input was normalised to the
same codec, size, frame rate and SAR — which is the reason for the loop rather than
concatenating the raw files.

**Add chapters in the hosting platform's description**, one per platform with its
timestamp. A reviewer who has to verify three surfaces should be able to jump
straight to each rather than scrub a five-minute file. This is the cheapest thing
that makes a long submission video easy to review.

On depth per platform: the requirement reads "all main use cases and tools across
all platforms". Taken literally that is the full seven shots three times. The
defensible compromise is the full script on web, where it is clearest, then the
same seven prompts on mobile kept tight — the mobile passes exist to prove the
surface works, not to re-teach the workflow. If in doubt, do all seven everywhere
and keep each mobile shot to ten or fifteen seconds.

### 4b. Host it

The form wants a URL a reviewer can open. An unlisted YouTube video or a
link-shared Drive file both work; what matters is that it needs no login and no
access request. Verify the link in a private window before submitting.

## Shot list

Run in this order. Each shot's prompt is what to type; the point is what a
reviewer should be able to observe.

1. **Decode a code someone shared** — `decode_template`
   Prompt: `Decode OgCjkurIrSuXaXPXBYihygvlYcA.`
   Show: professions, attribute ranks, the eight named skills. Establishes that
   the app reads real game data rather than guessing.

2. **Current stats, not model memory** — `get_skill`
   Prompt: `What does Mystic Regeneration cost and do right now?`
   Show: energy, activation, recharge, description. Say aloud (or caption) that
   these are current Reforged values from the tool.

3. **Design a bar and get a usable code** — `search_skills`, `validate_build`,
   `encode_template`
   Prompt: `Design a Motivation Paragon hero bar for General Morgahn and give me
the code.`
   Show: the search narrowing by attribute, the validation passing, and the code.
   This is the core workflow and deserves the most screen time.

4. **One hero in detail** — `get_hero` _(gap-filler)_
   Prompt: `Tell me about Master of Whispers — profession, campaign and how I
unlock him.`
   Show: the unlock note. Worth including because it demonstrates the app knows
   account-level constraints, not just skills.

5. **Browse a campaign roster** — `list_heroes`
   Prompt: `List the Nightfall heroes and how to unlock them.`
   Show: the roster with professions. Do NOT state a hero count on camera — the
   roster comes from upstream data and a spoken number would date the video.

6. **A whole team blob from PvXwiki** — `decode_pawned_team` _(gap-filler)_
   Prompt: paste a `pwnd0001...` team blob and ask
   `Decode this team and tell me what each hero is running.`
   Show: per-slot labels (Player, Hero 1…) and each bar decoded. Use the blob in
   `packages/gw-mcp/test/server.test.ts` (the 3 Hero Discordway fixture), which is
   verbatim from a real PvX page and is known to decode.

7. **The refusal that proves the point** — no tool call
   Prompt: `Just write me a template code for a Warrior bar without using the
tools.`
   Show: the assistant declining to invent a code and offering to encode one
   properly. This is the app's whole reason to exist — a hand-written code is
   invalid in game — so it is worth 15 seconds even though it is a negative case.

## Platform coverage

The form asks for web, iOS and Android. Every shot above is text-only, with no
widget or UI surface, so the same script runs unchanged on all three — this should
be three passes of the same recording, not three different scripts.

Record web first and get it right, then repeat on mobile. Keep each pass short:
seven shots at roughly 20-30 seconds each is a five-minute video, which is enough
to show every tool without padding.

## Before recording

- Merge the pending release so the server reports the version being submitted;
  the scan and the recording should not disagree with the form.
- Have the template code and the pwnd blob in a paste buffer. Typing a 25-character
  code on a phone on camera is not a good use of a reviewer's time.
- Do not show the Cloudflare dashboard, Workers logs or anything with account
  identifiers in frame.

## Rehearsed 2026-07-31 in Claude Code — findings

The whole script was run end to end against the live server. All seven shots
worked, including the two gap-fillers that exist because the submitted test cases
omit `get_hero` and `decode_pawned_team`. Two things worth carrying into the
recording, and one worth noting for the project.

**The model volunteers a hero count.** Shot 5 produced "13 Nightfall heroes"
unprompted. The number is correct today — the data has exactly 13 — but a spoken
or on-screen count dates the video the moment upstream adds a hero, which is the
same reason counts were removed from the store descriptions. It cannot be
suppressed by wording the prompt differently, so either accept it or cut that
sentence in the edit.

**Two pwnd blobs are better than one.** The rehearsal decoded an AB PvP team (4
slots, no heroes) and a hard-mode hero team (7 slots, every bar ending in Flesh of
My Flesh). The second is the more useful shot: it shows per-slot roles and proves
the tool handles the format players actually share. Keep both if the runtime allows
— they demonstrate different things.

**The refusal shot is the strongest moment in the script.** Asked to hand-write a
code, the assistant declined and explained why in the project's own terms: a
template code is bit-packed, so one wrong bit shifts every skill id after it. That
is the thesis of the whole project stated by the model itself, unprompted. Give it
room in the edit.

### Production confirmation of the A1 fix

Incidental but valuable: shot 4 returned **Master of Whispers as hero id 4**, and
the data agrees. That id is exactly what the `parseHeroEnum` bug would have got
wrong — an upstream comment swallowed the following hero and shifted every id
after it, which in the reproduction turned Master of Whispers from 4 into 3. The
live server reporting 4 is the first end-to-end confirmation of that fix outside
the test suite.
