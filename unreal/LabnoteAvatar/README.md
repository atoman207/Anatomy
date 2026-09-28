# LABNOTE realistic avatar: Unreal Engine 5 + MetaHuman + Audio2Face + Pixel Streaming

This folder holds the Unreal side of the LABNOTE AI assistant. The website (Next.js) already handles speech recognition, the conversation AI with LABNOTE knowledge (RAG), Japanese TTS, viseme extraction, emotion and gesture planning, and the avatar state machine. This plugin receives the result and turns it into a MetaHuman that talks, gestures, and listens, streamed to the browser over WebRTC.

```
Browser (Next.js)                                        GPU server
┌─────────────────────────────────────┐                 ┌──────────────────────────────────────┐
│ Mic → Web Speech STT                │                 │ Unreal Engine 5 (MetaHuman level)    │
│ /api/ai/chat  RAG + LLM → segments  │                 │  LabnoteAvatarController (this)      │
│   (speech, emotion, gesture, int.)  │  data channel   │   ├ OnSpeak → Audio2Face + audio     │
│ /api/ai/speech  TTS (WAV)           │ ──────────────► │   ├ OnCue   → montages / face / gaze │
│ planner → timed cues (70/20/10)     │                 │   └ State   → AnimBP                 │
│ viseme analysis → fallback visemes  │ ◄────────────── │  Pixel Streaming (video + audio)     │
│ <PixelStreamingAvatar> video        │   WebRTC A/V    │ Signalling server (wss://)           │
└─────────────────────────────────────┘                 └──────────────────────────────────────┘
```

When `NEXT_PUBLIC_PIXEL_STREAMING_URL` is unset or the stream can't connect, the website uses its browser-native three.js avatar instead (Option B). If there is no model file either, it shows the persona photo.

> **Status:** the web side is implemented and tested. The C++ in this folder has **not been compiled here**, because the development machine has no Unreal Engine or GPU. Build it in your UE project and fix any engine-version API differences the compiler reports. Node and plugin names for Pixel Streaming and NVIDIA ACE change between versions, so check them against the plugin versions you install.

---

## 1. What you need

| Item | Notes |
| --- | --- |
| Unreal Engine 5.6 (or newer) | Epic Games Launcher. The website uses `@epicgames-ps/lib-pixelstreamingfrontend-ue5.6`. For another engine version, install the matching `-ue5.x` package and change the import in `src/components/chatbot/avatar/PixelStreamingAvatar.tsx`. |
| MetaHuman | Create the character in MetaHuman Creator, or the MetaHuman plugin in UE 5.6+. For the persona in `public/landing/assistant-persona.png`: Japanese woman in her 20s, lab coat, upper body. |
| NVIDIA ACE / Audio2Face Unreal plugin | Real-time facial animation from audio (lips, jaw, cheeks, eyes, brows). Needs an NVIDIA GPU. |
| Pixel Streaming plugin | "Pixel Streaming 2" in recent engines (or "Pixel Streaming" in older ones). |
| Pixel Streaming Infrastructure | Signalling and web server: <https://github.com/EpicGames/PixelStreamingInfrastructure>. Use the branch for your engine version. |
| GPU server | NVIDIA RTX-class or data-centre GPU with NVENC (for example L4, A10G, RTX 4000 Ada or better). Windows or Linux. One GPU instance serves roughly 1–4 concurrent streams at 720p, depending on the scene. |
| TURN server | Needed for users behind strict NATs or corporate networks (coturn, or a managed TURN service). |

---

## 2. Unreal project

1. Create a blank C++ project (UE 5.6+).
2. Copy this folder to `YourProject/Plugins/LabnoteAvatar/`, regenerate project files, and build.
3. Enable these plugins: **Pixel Streaming (2)**, **MetaHuman**, **NVIDIA ACE (Audio2Face)**, **Live Link**.
4. Import your MetaHuman into a level. Frame it upper body in a softly lit lab-white set, with a `CineCameraActor` at eye height (35–50 mm, f/2.8 for gentle background blur).
5. Project Settings:
   - Pixel Streaming: disable mouse, keyboard, and touch input capture. The avatar is driven only by data-channel messages.
   - Rendering: enable **Lumen** and **Subsurface Profile** (skin), and set the anti-aliasing method to **TSR**.
   - Audio: enable the **Audio Mixer** (default in UE5).

### 2.1 Gesture library

Create one **Anim Montage** per gesture in [PROTOCOL.md](PROTOCOL.md#gesture-library) (`SmallNod`, `ExplainBoth`, `Bow`, …).
- Hand gestures use an `UpperBody` slot, and nods/tilts a `Head` slot, so gestures layer over the idle loop.
- Sources can be mocap (for example Rokoko or Move.ai), Marketplace packs, or hand-keyed animation. Keep them subtle: small amplitudes, 0.2 s blend-in and 0.3 s blend-out.

Create a DataTable `DT_LabnoteGestures` with row struct **LabnoteGestureRow**, row name = gesture name. Assign it to the controller's `GestureTable`.

### 2.2 Animation Blueprint (body)

Build a state machine on the controller's `State`:

| State | Pose |
| --- | --- |
| Idle | Blend `Idle01`/`Idle02` loops, plus breathing additive |
| Listening | `Listening` loop. Additive nod when `GetSecondsSinceUserActivity()` passes 0.15 s (max once per ~2.5 s) |
| Thinking | `Thinking` loop, gaze target moved up and to the side |
| Speaking | Idle base plus gesture montages from cues |
| Interrupted | 0.3 s brow flash (face), blend montages out |

Continuous subtle motion (about 70% of screen time) belongs in the AnimBP, not in cues:
- **Blinks:** every 2–5.5 s, with an occasional double blink. Audio2Face also blinks; disable one of the two.
- **Breathing:** 4–5 s cycle on the spine.
- **Micro head drift:** ±1–2°.
- **Eye saccades:** small, and mostly back to the camera.

Use a **Look At** (or Control Rig aim) toward the camera for eye contact. Switch the target on `gaze` cues.

---

## 3. Blueprint wiring (MetaHuman actor)

Add components: **LabnoteAvatarController**, **Pixel Streaming Input**, an **Audio** component attached to the head, and the **ACE Audio Curve Source** component on the Face mesh (per the ACE plugin docs).

| Event | Wire to |
| --- | --- |
| Pixel Streaming Input → **On Input Event** (Descriptor) | `LabnoteAvatarController.HandleUIInteraction(Descriptor)` |
| `OnResponse` (Json) | Pixel Streaming Input → **Send Pixel Streaming Response** (Json) |
| `OnSpeak` (Audio, Utterance) | 1) ACE **Animate Character From Sound Wave** on the face (or feed `GetUtteranceSamples` to the samples-based node, depending on the plugin version). 2) Set the Audio component's Sound = Audio and **Play**. 3) Set Audio2Face emotion from `Utterance.Emotion` ([mapping](PROTOCOL.md#emotions)). 4) Call **NotifySpeechStarted**. |
| `OnCue` (Cue) | Switch on `Cue.Kind`. **gesture:** `PlayGestureMontage(Body mesh, Cue.Name, Cue.Duration)`. **emotion:** update Audio2Face emotion strengths × `Cue.Intensity`. **gaze:** move the look-at target (`away` = up-left 10°, `user` = camera). |
| `OnSpeechEnded` | Stop the Audio component and the Audio2Face stream |
| `OnStop` | Same as `OnSpeechEnded`, plus **Montage Stop** (0.25 s blend) |
| `OnStateChanged` | Optional: drive camera or lighting changes |

If Audio2Face isn't available yet, drive the MetaHuman face curves from `GetVisemeWeights()` every tick:
- `aa` → `CTRL_expressions_jawOpen`
- `O`/`U` → `mouthFunnel`/`mouthPurse`
- `PP` → `mouthPressUpper`/`mouthLipsPressD`
- `FF` → `mouthLowerLipBiteD`
- `E`/`I` → `mouthStretch`

This lip sync is lower quality, but it works end-to-end.

**Why the audio plays inside Unreal:** the sound then travels in the same WebRTC stream as the video, so lips and voice stay in sync on the user's screen. The browser doesn't play the audio itself in this mode.

---

## 4. GPU server and streaming

1. Package the project (Windows or Linux, Shipping build).
2. On the GPU server, clone PixelStreamingInfrastructure (branch matching your engine) and start the signalling/web server. Note its WebSocket port (default 80 or 8888 for streamers).
3. Launch the packaged app pointing at the signalling server (the flag name depends on the plugin version; see the Pixel Streaming docs):
   ```
   LabnoteAvatar.exe -RenderOffscreen -Unattended -ResX=1280 -ResY=720 -ForceRes \
     -PixelStreamingURL=ws://127.0.0.1:8888
   ```
4. Put the player-facing WebSocket behind TLS (`wss://avatar.example.com`), because the site is served over HTTPS. Configure STUN and TURN in the signalling server's peer connection options.
5. Set in the website environment:
   ```
   NEXT_PUBLIC_PIXEL_STREAMING_URL=wss://avatar.example.com
   ```
   Redeploy. The voice chat modal and the video chat panel now show the MetaHuman.

**Scaling:** each browser session needs its own Unreal instance, because the avatar speaks to one person. Use the Pixel Streaming **Matchmaker** or SFU from PixelStreamingInfrastructure, plus autoscaling GPU instances. Stop instances when idle, since GPU hours are the main cost.

---

## 5. Checking it works

1. Open the site and start the voice chat. The video area shows 「アシスタントに接続しています…」, then the MetaHuman.
2. Click the mic and speak. The avatar turns to LISTENING: eye contact and small nods.
3. Click the mic again. The avatar moves to THINKING (gaze away), then SPEAKING: voice, Audio2Face lips, and a gesture on the key sentence.
4. Click the mic while it speaks. It shows a brief surprised look and stops talking (INTERRUPTED → LISTENING).
5. Stop the Unreal app. Within about 15 s the site falls back to the browser avatar or photo, and conversation still works.

In the browser console, `speech.started` and `speech.finished` responses should arrive for every reply.
