#pragma once
#include "CoreMinimal.h"

class UStaticMesh;
class USkeletalMesh;
class UAnimSequence;
class USoundBase;

// Finds the assets the import script created. Every model is imported into its own folder
// (/Game/FeralCoast/Models/<key>/), so lookups are by folder rather than by the importer's naming.
struct FERALCOAST_API FFCAssets
{
	static FString ModelPath(const FString& Key) { return FString::Printf(TEXT("/Game/FeralCoast/Models/%s"), *Key); }
	static UStaticMesh* StaticMesh(const FString& Key);
	static USkeletalMesh* SkeletalMesh(const FString& Key);
	// First animation in the model's folder whose name contains Clip (case-insensitive), e.g. "Run".
	static UAnimSequence* Anim(const FString& Key, const FString& Clip);
	static USoundBase* Sound(const FString& Name);
	// Uniform scale that makes Bounds' height (or longest horizontal side if bByLength) equal Target cm.
	static float FitScale(const FBox& Bounds, float Target, bool bByLength = false);
};
