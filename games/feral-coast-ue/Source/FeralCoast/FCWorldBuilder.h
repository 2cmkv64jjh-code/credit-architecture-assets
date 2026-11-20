#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "FCWorldBuilder.generated.h"

class UHierarchicalInstancedStaticMeshComponent;
class UMaterialInterface;

// Rebuilds the Feral Coast island content from Data/world.json + Data/circles.json (exported from the
// browser game): instanced forest and rocks, outpost structures, piers, radio masts, parked vehicles,
// and (at play time) the Ashen Tide garrisons. Drop one into a level that has the island landscape.
UCLASS()
class FERALCOAST_API AFCWorldBuilder : public AActor
{
	GENERATED_BODY()
public:
	AFCWorldBuilder();
	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, Category = "Build") bool bBuildVegetation = true;
	UPROPERTY(EditAnywhere, Category = "Build") bool bBuildStructures = true;
	UPROPERTY(EditAnywhere, Category = "Build") bool bSpawnEnemies = true;
	UPROPERTY(EditAnywhere, Category = "Build") float VegetationDensity = 1.f;   // >1 adds extra trees around each recorded one
	UPROPERTY(EditAnywhere, Category = "Build") UMaterialInterface* StructureMaterial = nullptr;
	UPROPERTY(EditAnywhere, Category = "Build") UMaterialInterface* RoofMaterial = nullptr;
	// Rebuild button (toggle) for the editor
	UPROPERTY(EditAnywhere, Category = "Build") bool bRebuild = false;

private:
	void Clear();
	UHierarchicalInstancedStaticMeshComponent* Hism(const FString& Key, bool bCollide);
	void BuildFrom(const TSharedPtr<class FJsonObject>& World, const TArray<TSharedPtr<class FJsonValue>>& Circles);
	static FVector ToUE(double X, double Y, double Z) { return FVector(X * 100.0, Z * 100.0, Y * 100.0); }
	static float YawToUE(double ThreeYaw) { return FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(ThreeYaw), -FMath::Sin(ThreeYaw))); }

	UPROPERTY(Transient) TArray<UActorComponent*> Built;
	TMap<FString, UHierarchicalInstancedStaticMeshComponent*> ByKey;
};
