# Demo

Captions + Voicebox narration, ~4–5 minute 1080p walkthrough of a DeepEval Data Tables benchmark in n8n.

Spoken lines and on-screen captions live in [`src/n8n-nodes-deepeval-demo-datatables.vtt`](src/n8n-nodes-deepeval-demo-datatables.vtt). Each cue has two voices (they may differ):

- `<v subtitle>` — burned-in caption while the cue is active. Omit for no bar (title / concept / outro).
- `<v narrator>` — Voicebox TTS from the cue’s start time. Omit for silence.

Cue ids are `title`, `concept`, `outro`, or `<sceneId>-<n>` (for example `dt-03-trigger-1`). Recapture retargets take cue times by scene id and leaves payload text alone.

After editing the VTT, rebuild the MP4 without re-recording:

```sh
npm run renarrate
```

That also works from the repo root. Unchanged narrator lines reuse the Voicebox WAV cache.

Checked-in assets under `public/` are only `harvard.mp3` (Voicebox clone profile) and `ambient.mp3` (bed). Take MP4s, Voicebox mixes, cue JSON, and `src/*.generated.json` are gitignored — they change whenever you edit the VTT and renarrate.

## Prerequisites

From the repo root: `npm run build && npm run ensure-llamafile`. Playwright Chromium, ffmpeg, the vendored llamafile judge, and **Voicebox** with the **harvard** profile and Chatterbox Turbo TTS are required.

```sh
export VOICEBOX_URL=http://127.0.0.1:17493
```

When the API is down, the pipeline launches `%LOCALAPPDATA%\Voicebox\voicebox.exe` (`LOCALAPPDATA` from the environment, or Windows if running under WSL).

## Pipeline

```sh
cd demo
npm ci
npm run build:video
```

That records a live n8n session (visible cursor, ~2× pacing), transcodes the one-shot take, generates Harvard/Chatterbox Turbo narration from the VTT, assembles the video, and muxes the voiceover into `out/n8n-nodes-deepeval-demo.mp4`. `public/ambient.mp3` loops under the mix and ducks while the narrator speaks.

Remotion only renders the title, concept, and outro cards (~30s). ffmpeg burns VTT `<v subtitle>` cues onto the take and concatenates intro + take + outro in one x264 pass. Playwright VP8 transcode still splits into parallel ~12s chunks.

| Script | What it does |
| --- | --- |
| `npm run record` | Boot n8n + llamafile via `startN8nSession({ testTarget: 'out' })`, record Data Table UI, editor, Results, and Benchmarks |
| `npm run transcode` | Parallel encode first→last scene of `full.webm` → `public/take.mp4`, retarget take cue times in the VTT |
| `npm run narrate` | Voicebox TTS mix from `<v narrator>` cues |
| `npm run renarrate` | `narrate` + `render` + `mux` (no recapture) |
| `npm run studio` | Remotion preview |
| `npm run render` | Remotion intro/outro cards + ffmpeg caption burn + concat → `out/n8n-nodes-deepeval-demo.raw.mp4` |
| `npm run mux` | Mux Voicebox mix + ambient + faststart → `out/n8n-nodes-deepeval-demo.mp4` |

## Scenes

1. Tour the DeepEval Source Data Table
2. Create workflow **Support Agent Benchmark**
3. Add DeepEval Trigger (cases from a Data Table)
4. Add G-Eval + Bias + local OpenAI-compatible judge
5. Add DeepEval Aggregate (pass rule + Results table insert)
6. Execute
7. Open the Results Data Table
8. Open the Benchmarks ABC dashboard
