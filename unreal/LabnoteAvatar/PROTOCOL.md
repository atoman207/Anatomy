# LABNOTE avatar protocol (v1)

The messages the website sends to Unreal Engine, and the replies Unreal sends back, over the Pixel Streaming data channel.

The source of truth is `src/lib/avatar/protocol.ts`. Change both files together, and bump `AVATAR_PROTOCOL_VERSION` together with `ProtocolVersion` in `LabnoteAvatarController.cpp`.

## Transport

| Direction | Browser API | Unreal side |
| --- | --- | --- |
| Browser → Unreal | `stream.emitUIInteraction(json)` | Pixel Streaming Input component → **On Input Event** (descriptor string) → `HandleUIInteraction` |
| Unreal → Browser | `stream.addResponseEventListener(...)` | `OnResponse` → **Send Pixel Streaming Response** |

Each message is one JSON object with a `type` field. Keep single messages under about 16 KB, because some browsers split or drop larger data-channel messages. That's why the audio arrives in chunks.

## Browser → Unreal

### `hello`
```json
{ "type": "hello", "version": 1 }
```
Sent once the data channel opens. Unreal answers `ready`.

### `state`
```json
{ "type": "state", "state": "LISTENING" }
```
The state is one of `IDLE` / `LISTENING` / `THINKING` / `SPEAKING` / `INTERRUPTED`. Drive the AnimBP state machine with it:

| State | Expected behaviour |
| --- | --- |
| IDLE | Idle01/Idle02 loops, blinking, breathing, small head drift |
| LISTENING | Eyes on the camera, slight head tilt, soft brows, back-channel nods on `listen.activity` |
| THINKING | Gaze up and to the side, brows gather slightly, `Thinking` loop |
| SPEAKING | Audio2Face face, plus gesture and emotion cues |
| INTERRUPTED | Brief brow flash, small pull back, stop gestures, then the browser sends `LISTENING` (~0.65 s) |

### `listen.activity`
```json
{ "type": "listen.activity", "level": 1 }
```
Sent at most every 0.4 s while the user is speaking. Use it for listener nods, and not on every event.

### Speech: `speak.begin` → `speak.chunk` × N → `speak.end`
```json
{
  "type": "speak.begin",
  "id": "lx3k2-a8f2c1",
  "audioFormat": "wav",
  "chunks": 3,
  "durationSec": 4.82,
  "text": "LABNOTEでは実験記録からAI査読まで利用できます。",
  "emotion": "friendly",
  "cues": [
    { "at": 0,    "duration": 4.82, "kind": "emotion", "name": "friendly",    "intensity": 0.4 },
    { "at": 0.35, "duration": 2.0,  "kind": "gesture", "name": "ExplainBoth", "intensity": 0.6 },
    { "at": 4.52, "duration": 0.6,  "kind": "emotion", "name": "neutral",     "intensity": 0.2 }
  ],
  "visemeFps": 30,
  "visemes": "<base64>"
}
{ "type": "speak.chunk", "id": "lx3k2-a8f2c1", "index": 0, "data": "<base64 of WAV bytes, part 0>" }
{ "type": "speak.end", "id": "lx3k2-a8f2c1" }
```

- **Audio:** RIFF WAV, PCM 16-bit, 24 kHz mono (OpenAI TTS). Concatenate the chunk strings in `index` order, then base64-decode.
- **Cues:** `at` is in seconds from the moment the audio starts, which is when you call `NotifySpeechStarted`. The website has already applied the human-likeness budget: strong hand gestures take at most 10% of the time, context motion at most 20%, and gestures never overlap on the same body part. Play cues as given rather than adding random gestures.
  - `kind: "gesture"`: a name from the gesture library below.
  - `kind: "emotion"`: the emotion from `at` on. Map it to Audio2Face emotion strengths and a facial pose.
  - `kind: "gaze"`: `away` (glance aside while thinking) or `user`.
- **Visemes:** fallback lip sync for when Audio2Face isn't wired. The track is sampled at `visemeFps`, with 9 bytes per frame (0–255) in the order `sil, PP, FF, SS, aa, E, I, O, U`. `GetVisemeWeights()` samples it at the current audio time.

### `stop`
```json
{ "type": "stop", "reason": "interrupted" }
```
The user cut in or closed the chat. Stop audio, Audio2Face, and gestures immediately.

## Unreal → Browser

```json
{ "type": "ready", "version": 1 }
{ "type": "speech.started", "id": "lx3k2-a8f2c1" }
{ "type": "speech.finished", "id": "lx3k2-a8f2c1" }
{ "type": "error", "message": "..." }
```

The browser keeps the avatar in `SPEAKING` until `speech.finished` arrives. If that message is lost, it gives up after `durationSec + 2.5 s`.

## Gesture library

Tier budgets: `subtle` has no limit, `context` ≤ 20%, `strong` ≤ 10%. Create one Anim Montage per name and list them in `DT_LabnoteGestures`, with the row name being the gesture name.

| Name | Tier | Body part | Length (s) | Notes |
| --- | --- | --- | --- | --- |
| Idle01, Idle02 | subtle | body | 6 | Looping idles (AnimBP, not cued) |
| Listening | subtle | head | 4 | Listening loop (AnimBP) |
| HeadForward | subtle | head | 0.6 | Slight forward head movement at a sentence start |
| Thinking | context | head | 2.2 | Thinking loop (AnimBP) |
| SmallNod | context | head | 0.7 | |
| LargeNod | context | head | 1.1 | |
| Agree | context | head | 1.2 | Double nod |
| HeadTilt | context | head | 1.4 | |
| LeanForward | context | body | 1.2 | |
| BrowRaise | context | face | 0.8 | Question intonation |
| Smile | context | face | 1.6 | |
| Confused | context | face | 1.5 | |
| Bow | strong | body | 1.6 | Japanese eshaku (~15°) |
| Greeting | strong | hands | 1.8 | |
| ThankYou | strong | body | 1.6 | Bow with a smile |
| ExplainLeft / ExplainRight | strong | hands | 1.8 | One-handed presenting gesture |
| ExplainBoth | strong | hands | 2.0 | |
| Point | strong | hands | 1.4 | |
| Count | strong | hands | 1.8 | Counting items on fingers |
| OpenPalms | strong | hands | 1.6 | |
| HandOnChest | strong | hands | 1.6 | Sincere or apologetic |

## Emotions

`neutral, friendly, happy, grateful, thinking, curious, concerned, apologetic, surprised, confident`

Suggested Audio2Face emotion mapping (0–1 × cue intensity):

| Emotion | Audio2Face strengths |
| --- | --- |
| neutral | all 0 |
| friendly | joy 0.3 |
| happy | joy 0.7 |
| grateful | joy 0.5, grief 0.05 |
| thinking | cheekiness 0.1 (plus gaze away) |
| curious | amazement 0.3 |
| concerned | grief 0.3, fear 0.1 |
| apologetic | grief 0.4 |
| surprised | amazement 0.8 |
| confident | joy 0.3, cheekiness 0.2 |
