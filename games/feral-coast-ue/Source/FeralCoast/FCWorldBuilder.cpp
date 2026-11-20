#include "FCWorldBuilder.h"
#include "FCAssets.h"
#include "FCEnemy.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Materials/MaterialInterface.h"

AFCWorldBuilder::AFCWorldBuilder()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

static bool LoadJson(const FString& File, TSharedPtr<FJsonValue>& Out)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *(FPaths::ProjectDir() / TEXT("Data") / File))) return false;
	TSharedRef<TJsonReader<>> R = TJsonReaderFactory<>::Create(Text);
	return FJsonSerializer::Deserialize(R, Out) && Out.IsValid();
}

void AFCWorldBuilder::Clear()
{
	for (UActorComponent* C : Built) if (C) C->DestroyComponent();
	Built.Reset(); ByKey.Reset();
}

UHierarchicalInstancedStaticMeshComponent* AFCWorldBuilder::Hism(const FString& Key, bool bCollide)
{
	if (UHierarchicalInstancedStaticMeshComponent** F = ByKey.Find(Key)) return *F;
	UStaticMesh* M = Key.StartsWith(TEXT("/")) ? LoadObject<UStaticMesh>(nullptr, *Key) : FFCAssets::StaticMesh(Key);
	if (!M) return nullptr;
	UHierarchicalInstancedStaticMeshComponent* H = NewObject<UHierarchicalInstancedStaticMeshComponent>(this, NAME_None, RF_Transient);
	H->SetStaticMesh(M);
	H->SetMobility(EComponentMobility::Static);
	H->SetCollisionEnabled(bCollide ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
	H->SetCullDistances(0, Key == TEXT("flower") ? 12000 : 90000);
	H->SetupAttachment(RootComponent);
	H->RegisterComponent();
	Built.Add(H); ByKey.Add(Key, H);
	return H;
}

void AFCWorldBuilder::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);
	bRebuild = false;
	Clear();
	TSharedPtr<FJsonValue> W, C;
	if (!LoadJson(TEXT("world.json"), W)) { UE_LOG(LogTemp, Warning, TEXT("FCWorldBuilder: Data/world.json not found")); return; }
	LoadJson(TEXT("circles.json"), C);
	static const TArray<TSharedPtr<FJsonValue>> Empty;
	BuildFrom(W->AsObject(), C.IsValid() ? C->AsArray() : Empty);
}

void AFCWorldBuilder::BuildFrom(const TSharedPtr<FJsonObject>& World, const TArray<TSharedPtr<FJsonValue>>& Circles)
{
	FRandomStream Rng(1337);
	auto Place = [this](const FString& Key, const FVector& Loc, float Yaw, float TargetCm, bool bByLength, bool bCollide, float Sink = 0.f)
	{
		UHierarchicalInstancedStaticMeshComponent* H = Hism(Key, bCollide);
		if (!H) return;
		const FBox B = H->GetStaticMesh()->GetBoundingBox();
		const float S = FFCAssets::FitScale(B, TargetCm, bByLength);
		const FVector Pivot((B.Min.X + B.Max.X) * 0.5f, (B.Min.Y + B.Max.Y) * 0.5f, B.Min.Z);
		const FRotator R(0.f, Yaw, 0.f);
		H->AddInstance(FTransform(R, Loc - R.RotateVector(Pivot * S) - FVector(0, 0, Sink), FVector(S)));
	};

	// --- vegetation: recorded obstacle circles (h >= 4 m are trees, the rest rocks) ---
	if (bBuildVegetation)
	{
		static const TCHAR* Trees[] = { TEXT("palm"), TEXT("palm"), TEXT("oak"), TEXT("treeFat") };
		for (const TSharedPtr<FJsonValue>& V : Circles)
		{
			const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
			const double X = A[0]->AsNumber(), Z = A[1]->AsNumber(), R = A[2]->AsNumber(), Hh = A[3]->AsNumber(), Y = A[4]->AsNumber();
			const FVector L = ToUE(X, Y, Z);
			if (Hh >= 4.0)
			{
				const FString Key = Y < 12.0 ? TEXT("palm") : Trees[Rng.RandRange(0, 3)];
				Place(Key, L, Rng.FRandRange(0.f, 360.f), Hh * 100.f * Rng.FRandRange(1.0f, 1.25f), false, true, 10.f);
				for (int32 k = 1; k < VegetationDensity; ++k)
				{
					const FVector O(Rng.FRandRange(-600.f, 600.f), Rng.FRandRange(-600.f, 600.f), 0.f);
					Place(Rng.RandRange(0, 2) == 0 ? TEXT("bushLarge") : TEXT("bush"), L + O, Rng.FRandRange(0.f, 360.f), Rng.FRandRange(90.f, 180.f), false, false, 15.f);
				}
			}
			else Place(Hh > 2.0 ? TEXT("rockTall") : TEXT("rock"), L, Rng.FRandRange(0.f, 360.f), FMath::Max(R * 200.0, 80.0), true, true, 20.f);
		}
	}

	if (!bBuildStructures) return;

	// --- outpost buildings, walls and towers (the game's collision boxes, rendered as textured blocks) ---
	UHierarchicalInstancedStaticMeshComponent* Blocks = Hism(TEXT("/Engine/BasicShapes/Cube.Cube"), true);
	if (Blocks && StructureMaterial) Blocks->SetMaterial(0, StructureMaterial);
	if (Blocks) for (const TSharedPtr<FJsonValue>& V : World->GetArrayField(TEXT("boxes")))
	{
		const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
		const FVector Mn = ToUE(A[0]->AsNumber(), A[1]->AsNumber(), A[2]->AsNumber()), Mx = ToUE(A[3]->AsNumber(), A[4]->AsNumber(), A[5]->AsNumber());
		const FVector Size = (Mx - Mn).GetAbs();
		if (Size.X < 5.f || Size.Y < 5.f || Size.Z < 5.f) continue;
		Blocks->AddInstance(FTransform(FRotator::ZeroRotator, (Mn + Mx) * 0.5f, Size / 100.f));
	}

	// --- radio masts on the relay towers and at each outpost ---
	for (const TSharedPtr<FJsonValue>& V : World->GetArrayField(TEXT("towers")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		Place(TEXT("radioTower"), ToUE(O->GetNumberField(TEXT("x")) + 6, O->GetNumberField(TEXT("y")), O->GetNumberField(TEXT("z"))), 0.f, 3200.f, false, true);
	}

	// --- piers out to the boat moorings ---
	for (const TSharedPtr<FJsonValue>& V : World->GetArrayField(TEXT("docks")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		const FVector Boat = ToUE(O->GetNumberField(TEXT("x")), 0, O->GetNumberField(TEXT("z")));
		const FVector Site = ToUE(O->GetNumberField(TEXT("siteX")), 0, O->GetNumberField(TEXT("siteZ")));
		const FVector Dir = (Site - Boat).GetSafeNormal();
		const float Yaw = Dir.Rotation().Yaw;
		for (float t = 400.f; t < 2600.f; t += 250.f) Place(TEXT("dock"), Boat + Dir * t + FVector(0, 0, 40.f), Yaw, 300.f, false, true, 250.f);
	}

	// --- parked vehicles (static set dressing in this first pass) ---
	for (const TSharedPtr<FJsonValue>& V : World->GetArrayField(TEXT("vehicles")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		const FString K = O->GetStringField(TEXT("kind"));
		const FString Key = K == TEXT("jeep") ? TEXT("suv") : K == TEXT("truck") ? TEXT("m939") : K == TEXT("boat") ? TEXT("kBoatRebel") : K == TEXT("tideboat") ? TEXT("kBoatTide") : TEXT("helicopter");
		const float Len = K == TEXT("truck") ? 620.f : K == TEXT("tideboat") ? 660.f : K == TEXT("boat") ? 540.f : K == TEXT("gyro") ? 900.f : 440.f;
		Place(Key, ToUE(O->GetNumberField(TEXT("x")), O->GetNumberField(TEXT("y")), O->GetNumberField(TEXT("z"))), YawToUE(O->GetNumberField(TEXT("yaw"))), Len, true, true, K.Contains(TEXT("boat")) ? 30.f : 0.f);
	}
}

void AFCWorldBuilder::BeginPlay()
{
	Super::BeginPlay();
	if (!bSpawnEnemies) return;
	TSharedPtr<FJsonValue> W;
	if (!LoadJson(TEXT("world.json"), W)) return;
	for (const TSharedPtr<FJsonValue>& V : W->AsObject()->GetArrayField(TEXT("enemies")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		const FString T = O->GetStringField(TEXT("type"));
		const EFCEnemyType Type = T == TEXT("heavy") ? EFCEnemyType::Heavy : T == TEXT("sniper") ? EFCEnemyType::Sniper : T == TEXT("boss") ? EFCEnemyType::Boss : EFCEnemyType::Grunt;
		const FVector L = ToUE(O->GetNumberField(TEXT("x")), O->GetNumberField(TEXT("y")), O->GetNumberField(TEXT("z"))) + FVector(0, 0, 100.f);
		AFCEnemy* E = GetWorld()->SpawnActorDeferred<AFCEnemy>(AFCEnemy::StaticClass(), FTransform(L), nullptr, nullptr, ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn);
		if (!E) continue;
		E->Setup(Type, YawToUE(O->GetNumberField(TEXT("yaw"))), O->GetBoolField(TEXT("tower")));
		E->FinishSpawning(FTransform(FRotator(0.f, YawToUE(O->GetNumberField(TEXT("yaw"))), 0.f), L));
	}
}
