// LABNOTE avatar controller: the Unreal end of src/lib/avatar/protocol.ts.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Engine/DataTable.h"
#include "LabnoteAvatarController.generated.h"

class USoundWaveProcedural;
class UAnimMontage;

UENUM(BlueprintType)
enum class ELabnoteAvatarState : uint8
{
	Idle,
	Listening,
	Thinking,
	Speaking,
	Interrupted,
};

/** One timed cue from the website's performance planner. */
USTRUCT(BlueprintType)
struct FLabnoteAvatarCue
{
	GENERATED_BODY()

	/** Seconds from the start of the utterance audio. */
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") float At = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") float Duration = 0.f;
	/** gesture | emotion | gaze | pause */
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") FName Kind;
	/** Gesture name (e.g. ExplainBoth), emotion name (e.g. friendly) or gaze target (user | away). */
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") FName Name;
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") float Intensity = 0.f;
};

/** Everything known about the utterance handed to OnSpeak. */
USTRUCT(BlueprintType)
struct FLabnoteUtterance
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") FString Id;
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") FString Text;
	/** Emotion of the first sentence; later ones arrive as emotion cues. */
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") FName Emotion;
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") float DurationSec = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE") TArray<FLabnoteAvatarCue> Cues;
};

/** Row of DT_LabnoteGestures: gesture library name -> Anim Montage. */
USTRUCT(BlueprintType)
struct FLabnoteGestureRow : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "LABNOTE") TObjectPtr<UAnimMontage> Montage = nullptr;
	/** Blend-in seconds; blend-out and slot come from the montage asset (UpperBody for hands, Head for nods). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "LABNOTE") float BlendIn = 0.2f;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FLabnoteStateChanged, ELabnoteAvatarState, State);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FLabnoteSpeak, USoundWave*, Audio, const FLabnoteUtterance&, Utterance);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FLabnoteCue, const FLabnoteAvatarCue&, Cue);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FLabnoteSimple);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FLabnoteResponse, const FString&, Json);

/**
 * Add to the MetaHuman actor. Blueprint wiring (see README.md):
 *
 *   Pixel Streaming Input component "On Input Event"  -> HandleUIInteraction
 *   OnResponse                                        -> "Send Pixel Streaming Response"
 *   OnSpeak    -> play Audio on the face's audio component + NVIDIA ACE Audio2Face
 *                 animate-from-SoundWave node, then call NotifySpeechStarted
 *   OnSpeechEnded -> stop the audio component / Audio2Face (fires at the known duration)
 *   OnCue      -> gesture: PlayGestureMontage / emotion: Audio2Face emotion + face
 *                 pose / gaze: look-at target
 *   OnStop     -> stop audio, stop Audio2Face, blend montages out
 *   State      -> AnimBP state machine (Idle / Listening / Thinking / Speaking)
 */
UCLASS(ClassGroup = (LABNOTE), meta = (BlueprintSpawnableComponent))
class LABNOTEAVATAR_API ULabnoteAvatarController : public UActorComponent
{
	GENERATED_BODY()

public:
	ULabnoteAvatarController();

	/** Gesture library name -> montage. Optional; without it OnCue still fires. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "LABNOTE")
	TObjectPtr<UDataTable> GestureTable = nullptr;

	UPROPERTY(BlueprintReadOnly, Category = "LABNOTE")
	ELabnoteAvatarState State = ELabnoteAvatarState::Idle;

	/** Seconds since the user last spoke (listener nods in the AnimBP). */
	UFUNCTION(BlueprintPure, Category = "LABNOTE")
	float GetSecondsSinceUserActivity() const;

	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteStateChanged OnStateChanged;
	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteSpeak OnSpeak;
	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteCue OnCue;
	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteSimple OnStop;
	/** The utterance reached its end: stop the audio component and Audio2Face stream. */
	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteSimple OnSpeechEnded;
	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteSimple OnUserActivity;
	/** JSON to send back to the browser via "Send Pixel Streaming Response". */
	UPROPERTY(BlueprintAssignable, Category = "LABNOTE") FLabnoteResponse OnResponse;

	/** Feed every Pixel Streaming UI interaction descriptor here. */
	UFUNCTION(BlueprintCallable, Category = "LABNOTE")
	void HandleUIInteraction(const FString& Descriptor);

	/** Call when the utterance audio actually starts playing; starts the cue clock. */
	UFUNCTION(BlueprintCallable, Category = "LABNOTE")
	void NotifySpeechStarted();

	/** Call when the utterance audio finishes. */
	UFUNCTION(BlueprintCallable, Category = "LABNOTE")
	void NotifySpeechFinished();

	/** Fallback lip sync (no Audio2Face): weights for sil, PP, FF, SS, aa, E, I, O, U at the current audio time. */
	UFUNCTION(BlueprintPure, Category = "LABNOTE")
	TArray<float> GetVisemeWeights() const;

	/**
	 * The current utterance as float samples (-1..1, interleaved), for Audio2Face
	 * nodes that take raw samples instead of a SoundWave.
	 */
	UFUNCTION(BlueprintCallable, Category = "LABNOTE")
	bool GetUtteranceSamples(TArray<float>& Samples, int32& SampleRate, int32& NumChannels) const;

	/**
	 * Plays the library gesture's montage, time-fitted to the planned cue duration.
	 * Returns false when the gesture has no row/montage (the cue can still drive the face).
	 */
	UFUNCTION(BlueprintCallable, Category = "LABNOTE")
	bool PlayGestureMontage(USkeletalMeshComponent* Mesh, FName Gesture, float DurationSec);

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	struct FPending
	{
		FLabnoteUtterance Utterance;
		int32 ChunkCount = 0;
		TArray<FString> Chunks;
		int32 VisemeFps = 30;
		TArray<uint8> Visemes;
	};

	TMap<FString, FPending> Pending;

	FString ActiveId;
	TArray<FLabnoteAvatarCue> ActiveCues;
	TArray<uint8> ActiveVisemes;
	int32 ActiveVisemeFps = 30;
	int32 NextCue = 0;
	double SpeechStartedAt = -1.0;
	double LastUserActivity = -1000.0;
	float ActiveDuration = 0.f;
	TArray<uint8> ActivePcm;
	int32 ActiveSampleRate = 24000;
	int32 ActiveChannels = 1;

	void SetState(ELabnoteAvatarState NewState);
	void Respond(const FString& Type, const FString& Id = FString());
	void FinishUtterance(const FString& Id);
	double Now() const;

	/** Parses 16-bit PCM WAV; fills the PCM/format outputs and returns a playable sound. */
	static USoundWaveProcedural* MakeSoundFromWav(const TArray<uint8>& Wav, float& OutDuration, TArray<uint8>& OutPcm, int32& OutSampleRate, int32& OutChannels);
};
