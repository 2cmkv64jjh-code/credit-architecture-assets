#include "FCAssets.h"
#include "AssetRegistryModule.h"
#include "Engine/StaticMesh.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "Sound/SoundBase.h"

namespace
{
	template <typename T>
	T* FindInFolder(const FString& Folder, const FString& NameContains = FString())
	{
		FAssetRegistryModule& ARM = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
		TArray<FAssetData> Assets;
		ARM.Get().GetAssetsByPath(FName(*Folder), Assets, /*bRecursive*/ true);
		for (const FAssetData& A : Assets)
		{
			UClass* C = A.GetClass();
			if (!C || !C->IsChildOf(T::StaticClass())) continue;
			if (!NameContains.IsEmpty() && !A.AssetName.ToString().Contains(NameContains, ESearchCase::IgnoreCase)) continue;
			if (T* Obj = Cast<T>(A.GetAsset())) return Obj;
		}
		return nullptr;
	}
}

UStaticMesh* FFCAssets::StaticMesh(const FString& Key) { return FindInFolder<UStaticMesh>(ModelPath(Key)); }
USkeletalMesh* FFCAssets::SkeletalMesh(const FString& Key) { return FindInFolder<USkeletalMesh>(ModelPath(Key)); }
UAnimSequence* FFCAssets::Anim(const FString& Key, const FString& Clip) { return FindInFolder<UAnimSequence>(ModelPath(Key), Clip); }

USoundBase* FFCAssets::Sound(const FString& Name)
{
	return LoadObject<USoundBase>(nullptr, *FString::Printf(TEXT("/Game/FeralCoast/Sounds/%s.%s"), *Name, *Name), nullptr, LOAD_NoWarn | LOAD_Quiet);
}

float FFCAssets::FitScale(const FBox& Bounds, float Target, bool bByLength)
{
	const FVector S = Bounds.GetSize();
	const float Ref = bByLength ? FMath::Max(S.X, S.Y) : S.Z;
	return Ref > KINDA_SMALL_NUMBER ? Target / Ref : 1.f;
}
