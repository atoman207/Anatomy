/**
 * Browser-native speech recognition (Web Speech API).
 *
 * Free: no API key, no account, no per-minute cost. Chrome and Edge send the
 * audio to Google's speech service; Safari uses Apple's. Both handle Japanese
 * well and return interim results as you speak, which the paid file-upload
 * path cannot do.
 *
 * The catch, and why this module is defensive: Chromium builds without
 * Google's speech key - Playwright's bundled browser, some Linux distro
 * packages, Electron - expose the whole API and then do nothing at all when
 * `start()` is called. No error, no events. A watchdog is the only way to tell
 * that apart from a user who simply has not spoken yet.
 */

/* The Web Speech API is not in the DOM lib, so its shape is declared here. */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onaudiostart: ((e: Event) => void) | null;
  onspeechstart: ((e: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getConstructor() !== null;
}

/* ------------------------------------------------------------------ */
/* Transcript accumulation                                             */
/* ------------------------------------------------------------------ */

export interface TranscriptState {
  /** Text the engine has committed and will not revise. */
  final: string;
  /** Current best guess for the phrase in progress, replaced as you speak. */
  interim: string;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { final: "", interim: "" };

/**
 * SpeechRecognitionResultList / Result are host objects. Chromium exposes
 * numeric indexers; some WebKit builds only implement `.item(i)`. Reading
 * `results[i][0]` then silently yields `undefined` and the transcript never
 * appears — which is exactly the failure mode the voice page was showing.
 */
function listEntry(
  list: SpeechRecognitionResultListLike,
  index: number,
): SpeechRecognitionResultLike | undefined {
  const byIndex = list[index];
  if (byIndex) return byIndex;
  const item = (list as { item?: (n: number) => SpeechRecognitionResultLike }).item;
  return typeof item === "function" ? item.call(list, index) : undefined;
}

function alternativeOf(
  result: SpeechRecognitionResultLike,
): SpeechRecognitionAlternativeLike | undefined {
  const byIndex = result[0];
  if (byIndex) return byIndex;
  const item = (result as { item?: (n: number) => SpeechRecognitionAlternativeLike }).item;
  return typeof item === "function" ? item.call(result, 0) : undefined;
}

/** Rebuilds committed + in-progress text from a complete result list. */
export function foldResultList(results: SpeechRecognitionResultListLike): TranscriptState {
  let final = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const result = listEntry(results, i);
    const alternative = result ? alternativeOf(result) : undefined;
    if (!result || !alternative) continue;
    if (result.isFinal) final += alternative.transcript;
    else interim += alternative.transcript;
  }
  return { final, interim };
}

/**
 * Folds one recognition event into the running transcript.
 *
 * The event carries the whole result list, not just what changed, and
 * `resultIndex` marks where the new material starts. Appending the entire list
 * every time is the classic bug here: it duplicates every phrase.
 *
 * Kept pure so the accumulation logic can be tested without a browser.
 */
export function applyResult(
  state: TranscriptState,
  event: Pick<SpeechRecognitionEventLike, "resultIndex" | "results">,
): TranscriptState {
  let finalAddition = "";
  let interim = "";

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = listEntry(event.results, i);
    const alternative = result ? alternativeOf(result) : undefined;
    if (!result || !alternative) continue;
    if (result.isFinal) finalAddition += alternative.transcript;
    else interim += alternative.transcript;
  }

  return {
    final: joinJapanese(state.final, finalAddition),
    interim,
  };
}

/**
 * Joins two transcript fragments.
 *
 * Japanese does not use spaces between words, and the engine returns segments
 * that already carry any punctuation. Inserting a space between them would put
 * gaps inside sentences; a space is only added when both sides are Latin, where
 * running words together would be wrong instead.
 */
export function joinJapanese(left: string, right: string): string {
  const a = left.trimEnd();
  const b = right.trimStart();
  if (!a) return b;
  if (!b) return a;
  const needsSpace = /[A-Za-z0-9)\]]$/.test(a) && /^[A-Za-z0-9([]/.test(b);
  return needsSpace ? `${a} ${b}` : a + b;
}

/** The full text, including the phrase still being spoken. */
export function fullTranscript(state: TranscriptState): string {
  return joinJapanese(state.final, state.interim);
}

/* ------------------------------------------------------------------ */
/* Error classification                                                */
/* ------------------------------------------------------------------ */

export type SpeechErrorKind =
  | "not-allowed"
  | "no-microphone"
  | "network"
  | "no-speech"
  | "aborted"
  | "language"
  | "unknown";

export interface ClassifiedError {
  kind: SpeechErrorKind;
  message: string;
  /** True when the session can simply be restarted without user action. */
  recoverable: boolean;
}

/**
 * Maps the spec's terse error codes onto something a researcher can act on.
 *
 * `no-speech` and `aborted` are routine during dictation - the engine gives up
 * after a pause - so they are recoverable and the session restarts silently.
 */
export function classifyError(code: string): ClassifiedError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        kind: "not-allowed",
        message:
          "マイクの使用が許可されていません。ブラウザのアドレスバーのマイクアイコンから許可してください。",
        recoverable: false,
      };
    case "audio-capture":
      return {
        kind: "no-microphone",
        message: "マイクが見つかりません。接続と入力デバイスの設定を確認してください。",
        recoverable: false,
      };
    case "network":
      return {
        kind: "network",
        message:
          "音声認識サービスに接続できません。このブラウザが対応していないか、ネットワークが遮断されています。有料のAI文字起こしに切り替えてください。",
        recoverable: false,
      };
    case "no-speech":
      return {
        kind: "no-speech",
        message: "音声が検出されませんでした。",
        recoverable: true,
      };
    case "aborted":
      return { kind: "aborted", message: "認識が中断されました。", recoverable: true };
    case "language-not-supported":
      return {
        kind: "language",
        message: "この言語には対応していません。",
        recoverable: false,
      };
    default:
      return { kind: "unknown", message: `音声認識エラー: ${code}`, recoverable: true };
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export interface SpeechSessionCallbacks {
  onTranscript: (state: TranscriptState) => void;
  onError: (error: ClassifiedError) => void;
  onStateChange: (listening: boolean) => void;
  /** Fired when the engine exists but never responded to `start()`. */
  onDead: () => void;
}

export interface SpeechSessionOptions {
  lang?: string;
  /** Milliseconds to wait for any sign of life before declaring it dead. */
  watchdogMs?: number;
}

/**
 * A continuous dictation session.
 *
 * Chrome ends recognition after a pause even with `continuous = true`, so a
 * long memo needs the session restarted transparently. Restarts are only
 * attempted while the user still intends to be recording, and are capped so a
 * genuinely broken engine cannot spin.
 */
export class SpeechSession {
  private recognition: SpeechRecognitionLike | null = null;
  private state: TranscriptState = EMPTY_TRANSCRIPT;
  /** Text committed by previous recognizer instances; the current instance's
   *  result list is folded on top of this so a restart cannot drop or duplicate. */
  private committed = "";
  private wantListening = false;
  private sawAnyEvent = false;
  private restarts = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly MAX_RESTARTS = 200;

  constructor(
    private readonly callbacks: SpeechSessionCallbacks,
    private readonly options: SpeechSessionOptions = {},
  ) {}

  get transcript(): TranscriptState {
    return this.state;
  }

  /** Replaces the transcript, e.g. after the researcher edits it by hand. */
  setTranscript(final: string): void {
    this.committed = final;
    this.state = { final, interim: "" };
    this.callbacks.onTranscript(this.state);
  }

  start(): void {
    const Ctor = getConstructor();
    if (!Ctor) {
      this.callbacks.onError({
        kind: "unknown",
        message: "このブラウザは音声認識に対応していません。",
        recoverable: false,
      });
      this.callbacks.onStateChange(false);
      return;
    }

    this.wantListening = true;
    this.restarts = 0;
    this.sawAnyEvent = false;
    this.spawn(Ctor);

    // Nothing at all within the watchdog window means the engine is present
    // but non-functional, which is how a Chromium build without Google's
    // speech key behaves. Permission prompts can eat several seconds, so
    // this is generous — a working engine fires `onstart` almost immediately.
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      if (!this.sawAnyEvent && this.wantListening) {
        this.stop();
        this.callbacks.onDead();
      }
    }, this.options.watchdogMs ?? 4000);
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /** Drops the current recognizer without treating it as a user stop. */
  private detachRecognition(): void {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    recognition.onaudiostart = null;
    recognition.onspeechstart = null;
    try {
      recognition.abort();
    } catch {
      // Already gone.
    }
  }

  private spawn(Ctor: SpeechRecognitionCtor): void {
    this.detachRecognition();
    // Anything the previous instance finalized stays in `committed`; the new
    // instance starts with an empty result list.
    this.committed = joinJapanese(this.state.final, this.state.interim);
    this.state = { final: this.committed, interim: "" };

    const recognition = new Ctor();
    recognition.lang = this.options.lang ?? "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const alive = () => {
      this.sawAnyEvent = true;
      this.clearWatchdog();
    };

    recognition.onstart = () => {
      alive();
      this.callbacks.onStateChange(true);
    };
    recognition.onaudiostart = alive;
    recognition.onspeechstart = alive;

    recognition.onresult = (event) => {
      alive();
      // Fold the *current* recognizer's full list. Using `resultIndex` against
      // a restarted instance is how Chrome drops spoken text: after `onend`
      // the list resets but `resultIndex` can still point past the new length.
      const slice = foldResultList(event.results);
      this.state = {
        final: joinJapanese(this.committed, slice.final),
        interim: slice.interim,
      };
      this.callbacks.onTranscript(this.state);
    };

    recognition.onerror = (event) => {
      alive();
      const classified = classifyError(event.error);
      // Routine pauses are not worth showing; the restart in onend covers them.
      if (!classified.recoverable) {
        this.wantListening = false;
        this.clearRestartTimer();
        this.callbacks.onError(classified);
        this.callbacks.onStateChange(false);
      }
    };

    recognition.onend = () => {
      // Anything still uncommitted is kept rather than dropped on restart.
      if (this.state.interim) {
        this.state = { final: joinJapanese(this.state.final, this.state.interim), interim: "" };
        this.callbacks.onTranscript(this.state);
      }
      if (this.wantListening && this.restarts < SpeechSession.MAX_RESTARTS) {
        this.restarts++;
        // Chrome throws InvalidStateError if start() is called on the same
        // instance from inside onend. A fresh instance after a tick is stable.
        const Next = getConstructor();
        if (Next) {
          this.clearRestartTimer();
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (this.wantListening) this.spawn(Next);
          }, 60);
          return;
        }
      }
      this.callbacks.onStateChange(false);
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (e) {
      this.callbacks.onError({
        kind: "unknown",
        message: e instanceof Error ? e.message : "音声認識を開始できませんでした。",
        recoverable: false,
      });
      this.callbacks.onStateChange(false);
    }
  }

  stop(): void {
    this.wantListening = false;
    this.clearWatchdog();
    this.clearRestartTimer();
    try {
      this.recognition?.stop();
    } catch {
      // Already stopped.
    }
    this.callbacks.onStateChange(false);
  }

  dispose(): void {
    this.wantListening = false;
    this.clearWatchdog();
    this.clearRestartTimer();
    this.detachRecognition();
  }
}
