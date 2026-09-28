#include "LabnoteAvatarController.h"

#include "Animation/AnimInstance.h"
#include "Animation/AnimMontage.h"
#include "Components/SkeletalMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "HAL/PlatformTime.h"
#include "Misc/Base64.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Sound/SoundWaveProcedural.h"

namespace
{
	/** Must match AVATAR_PROTOCOL_VERSION in src/lib/avatar/protocol.ts. */
	constexpr int32 ProtocolVersion = 1;
	constexpr int32 VisemeCount = 9; // sil, PP, FF, SS, aa, E, I, O, U

	ELabnoteAvatarState ParseState(const FString& S)
	{
		if (S == TEXT("LISTENING")) return ELabnoteAvatarState::Listening;
		if (S == TEXT("THINKING")) return ELabnoteAvatarState::Thinking;
		if (S == TEXT("SPEAKING")) return ELabnoteAvatarState::Speaking;
		if (S == TEXT("INTERRUPTED")) return ELabnoteAvatarState::Interrupted;
		return ELabnoteAvatarState::Idle;
	}

	uint32 ReadU32(const TArray<uint8>& B, int32 At)
	{
		return B[At] | (B[At + 1] << 8) | (B[At + 2] << 16) | (B[At + 3] << 24);
	}

	uint16 ReadU16(const TArray<uint8>& B, int32 At)
	{
		return B[At] | (B[At + 1] << 8);
	}
}

ULabnoteAvatarController::ULabnoteAvatarController()
{
	PrimaryComponentTick.bCanEverTick = true;
}

double ULabnoteAvatarController::Now() const
{
	return FPlatformTime::Seconds();
}

float ULabnoteAvatarController::GetSecondsSinceUserActivity() const
{
	return static_cast<float>(Now() - LastUserActivity);
}

void ULabnoteAvatarController::SetState(ELabnoteAvatarState NewState)
{
	if (State == NewState) return;
	State = NewState;
	OnStateChanged.Broadcast(State);
}

void ULabnoteAvatarController::Respond(const FString& Type, const FString& Id)
{
	FString Json;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Json);
	Writer->WriteObjectStart();
	Writer->WriteValue(TEXT("type"), Type);
	if (!Id.IsEmpty()) Writer->WriteValue(TEXT("id"), Id);
	if (Type == TEXT("ready")) Writer->WriteValue(TEXT("version"), ProtocolVersion);
	Writer->WriteObjectEnd();
	Writer->Close();
	OnResponse.Broadcast(Json);
}

void ULabnoteAvatarController::HandleUIInteraction(const FString& Descriptor)
{
	TSharedPtr<FJsonObject> Msg;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Descriptor), Msg) || !Msg.IsValid()) return;

	FString Type;
	if (!Msg->TryGetStringField(TEXT("type"), Type)) return;

	if (Type == TEXT("hello"))
	{
		Respond(TEXT("ready"));
	}
	else if (Type == TEXT("state"))
	{
		SetState(ParseState(Msg->GetStringField(TEXT("state"))));
	}
	else if (Type == TEXT("listen.activity"))
	{
		LastUserActivity = Now();
		OnUserActivity.Broadcast();
	}
	else if (Type == TEXT("speak.begin"))
	{
		FPending P;
		P.Utterance.Id = Msg->GetStringField(TEXT("id"));
		P.Utterance.Text = Msg->GetStringField(TEXT("text"));
		P.Utterance.Emotion = FName(*Msg->GetStringField(TEXT("emotion")));
		P.Utterance.DurationSec = static_cast<float>(Msg->GetNumberField(TEXT("durationSec")));
		P.ChunkCount = static_cast<int32>(Msg->GetNumberField(TEXT("chunks")));
		P.Chunks.SetNum(FMath::Clamp(P.ChunkCount, 0, 4096));
		P.VisemeFps = FMath::Max(1, static_cast<int32>(Msg->GetNumberField(TEXT("visemeFps"))));
		FBase64::Decode(Msg->GetStringField(TEXT("visemes")), P.Visemes);

		for (const TSharedPtr<FJsonValue>& V : Msg->GetArrayField(TEXT("cues")))
		{
			const TSharedPtr<FJsonObject> C = V->AsObject();
			if (!C.IsValid()) continue;
			FLabnoteAvatarCue Cue;
			Cue.At = static_cast<float>(C->GetNumberField(TEXT("at")));
			Cue.Duration = static_cast<float>(C->GetNumberField(TEXT("duration")));
			Cue.Kind = FName(*C->GetStringField(TEXT("kind")));
			Cue.Name = FName(*C->GetStringField(TEXT("name")));
			Cue.Intensity = static_cast<float>(C->GetNumberField(TEXT("intensity")));
			P.Utterance.Cues.Add(Cue);
		}
		Pending.Add(P.Utterance.Id, MoveTemp(P));
	}
	else if (Type == TEXT("speak.chunk"))
	{
		FPending* P = Pending.Find(Msg->GetStringField(TEXT("id")));
		const int32 Index = static_cast<int32>(Msg->GetNumberField(TEXT("index")));
		if (P && P->Chunks.IsValidIndex(Index)) P->Chunks[Index] = Msg->GetStringField(TEXT("data"));
	}
	else if (Type == TEXT("speak.end"))
	{
		const FString Id = Msg->GetStringField(TEXT("id"));
		FPending P;
		if (!Pending.RemoveAndCopyValue(Id, P)) return;

		TArray<uint8> Wav;
		if (!FBase64::Decode(FString::Join(P.Chunks, TEXT("")), Wav))
		{
			Respond(TEXT("speech.finished"), Id);
			return;
		}
		float Duration = P.Utterance.DurationSec;
		TArray<uint8> Pcm;
		int32 SampleRate = 24000;
		int32 Channels = 1;
		USoundWaveProcedural* Sound = MakeSoundFromWav(Wav, Duration, Pcm, SampleRate, Channels);
		if (!Sound)
		{
			Respond(TEXT("speech.finished"), Id);
			return;
		}
		P.Utterance.DurationSec = Duration;

		// A new utterance replaces whatever was playing.
		if (!ActiveId.IsEmpty()) OnStop.Broadcast();
		ActiveId = Id;
		ActiveCues = P.Utterance.Cues;
		ActiveCues.Sort([](const FLabnoteAvatarCue& A, const FLabnoteAvatarCue& B) { return A.At < B.At; });
		ActiveVisemes = MoveTemp(P.Visemes);
		ActiveVisemeFps = P.VisemeFps;
		NextCue = 0;
		SpeechStartedAt = -1.0;
		ActiveDuration = Duration;
		ActivePcm = MoveTemp(Pcm);
		ActiveSampleRate = SampleRate;
		ActiveChannels = Channels;

		OnSpeak.Broadcast(Sound, P.Utterance);
	}
	else if (Type == TEXT("stop"))
	{
		Pending.Empty();
		if (!ActiveId.IsEmpty())
		{
			const FString Id = ActiveId;
			ActiveId.Reset();
			SpeechStartedAt = -1.0;
			OnStop.Broadcast();
			Respond(TEXT("speech.finished"), Id);
		}
	}
}

void ULabnoteAvatarController::NotifySpeechStarted()
{
	if (ActiveId.IsEmpty() || SpeechStartedAt >= 0.0) return;
	SpeechStartedAt = Now();
	Respond(TEXT("speech.started"), ActiveId);
}

void ULabnoteAvatarController::NotifySpeechFinished()
{
	if (!ActiveId.IsEmpty()) FinishUtterance(ActiveId);
}

void ULabnoteAvatarController::FinishUtterance(const FString& Id)
{
	ActiveId.Reset();
	ActiveCues.Reset();
	ActiveVisemes.Reset();
	ActivePcm.Reset();
	SpeechStartedAt = -1.0;
	OnSpeechEnded.Broadcast();
	Respond(TEXT("speech.finished"), Id);
}

void ULabnoteAvatarController::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (ActiveId.IsEmpty() || SpeechStartedAt < 0.0) return;

	const float Elapsed = static_cast<float>(Now() - SpeechStartedAt);
	while (NextCue < ActiveCues.Num() && ActiveCues[NextCue].At <= Elapsed)
	{
		OnCue.Broadcast(ActiveCues[NextCue]);
		++NextCue;
	}

	// Procedural sounds keep rendering silence when their queue runs dry, so
	// "On Audio Finished" is not reliable; the known duration is.
	if (Elapsed > ActiveDuration + 0.25f) FinishUtterance(ActiveId);
}

TArray<float> ULabnoteAvatarController::GetVisemeWeights() const
{
	TArray<float> Out;
	Out.Init(0.f, VisemeCount);
	Out[0] = 1.f;
	if (ActiveId.IsEmpty() || SpeechStartedAt < 0.0 || ActiveVisemes.Num() < VisemeCount) return Out;

	const int32 Frames = ActiveVisemes.Num() / VisemeCount;
	const float F = static_cast<float>(Now() - SpeechStartedAt) * ActiveVisemeFps;
	const int32 I0 = FMath::Clamp(FMath::FloorToInt(F), 0, Frames - 1);
	const int32 I1 = FMath::Min(I0 + 1, Frames - 1);
	const float T = FMath::Clamp(F - I0, 0.f, 1.f);
	for (int32 V = 0; V < VisemeCount; ++V)
	{
		const float A = ActiveVisemes[I0 * VisemeCount + V] / 255.f;
		const float B = ActiveVisemes[I1 * VisemeCount + V] / 255.f;
		Out[V] = FMath::Lerp(A, B, T);
	}
	return Out;
}

bool ULabnoteAvatarController::GetUtteranceSamples(TArray<float>& Samples, int32& SampleRate, int32& NumChannels) const
{
	SampleRate = ActiveSampleRate;
	NumChannels = ActiveChannels;
	const int32 Count = ActivePcm.Num() / 2;
	Samples.SetNumUninitialized(Count);
	for (int32 I = 0; I < Count; ++I)
	{
		const int16 S = static_cast<int16>(ActivePcm[I * 2] | (ActivePcm[I * 2 + 1] << 8));
		Samples[I] = S / 32768.f;
	}
	return Count > 0;
}

bool ULabnoteAvatarController::PlayGestureMontage(USkeletalMeshComponent* Mesh, FName Gesture, float DurationSec)
{
	if (!Mesh || !GestureTable) return false;
	const FLabnoteGestureRow* Row = GestureTable->FindRow<FLabnoteGestureRow>(Gesture, TEXT("LabnoteGesture"), false);
	if (!Row || !Row->Montage) return false;
	UAnimInstance* Anim = Mesh->GetAnimInstance();
	if (!Anim) return false;

	// Fit the clip to the planned cue so the gesture lands on its sentence,
	// within a range that still looks like natural speed.
	const float Length = Row->Montage->GetPlayLength();
	const float Rate = DurationSec > 0.f && Length > 0.f ? FMath::Clamp(Length / DurationSec, 0.6f, 1.6f) : 1.f;
	return Anim->Montage_PlayWithBlendIn(Row->Montage, FAlphaBlendArgs(Row->BlendIn), Rate) > 0.f;
}

USoundWaveProcedural* ULabnoteAvatarController::MakeSoundFromWav(const TArray<uint8>& Wav, float& OutDuration, TArray<uint8>& OutPcm, int32& OutSampleRate, int32& OutChannels)
{
	// RIFF/WAVE, PCM 16-bit. OpenAI TTS returns 24 kHz mono.
	if (Wav.Num() < 44 || FMemory::Memcmp(Wav.GetData(), "RIFF", 4) != 0 || FMemory::Memcmp(Wav.GetData() + 8, "WAVE", 4) != 0)
	{
		return nullptr;
	}

	int32 Channels = 1;
	int32 SampleRate = 24000;
	int32 Bits = 16;
	int32 DataOffset = -1;
	int32 DataSize = 0;

	int32 At = 12;
	while (At + 8 <= Wav.Num())
	{
		const uint32 ChunkSize = ReadU32(Wav, At + 4);
		if (FMemory::Memcmp(Wav.GetData() + At, "fmt ", 4) == 0 && At + 24 <= Wav.Num())
		{
			Channels = ReadU16(Wav, At + 10);
			SampleRate = static_cast<int32>(ReadU32(Wav, At + 12));
			Bits = ReadU16(Wav, At + 22);
		}
		else if (FMemory::Memcmp(Wav.GetData() + At, "data", 4) == 0)
		{
			DataOffset = At + 8;
			// Streaming encoders write 0xFFFFFFFF when the length was unknown.
			DataSize = static_cast<int32>(FMath::Min<int64>(ChunkSize, Wav.Num() - DataOffset));
			break;
		}
		At += 8 + static_cast<int32>(ChunkSize) + (ChunkSize & 1);
	}
	if (DataOffset < 0 || Bits != 16 || Channels < 1 || SampleRate <= 0) return nullptr;

	USoundWaveProcedural* Sound = NewObject<USoundWaveProcedural>();
	Sound->SetSampleRate(SampleRate);
	Sound->NumChannels = Channels;
	OutDuration = static_cast<float>(DataSize) / (SampleRate * Channels * 2);
	Sound->Duration = OutDuration;
	Sound->SoundGroup = SOUNDGROUP_Voice;
	Sound->bLooping = false;
	Sound->QueueAudio(Wav.GetData() + DataOffset, DataSize);
	OutPcm.Append(Wav.GetData() + DataOffset, DataSize);
	OutSampleRate = SampleRate;
	OutChannels = Channels;
	return Sound;
}
