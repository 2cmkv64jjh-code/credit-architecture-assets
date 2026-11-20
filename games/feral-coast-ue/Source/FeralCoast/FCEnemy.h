#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "FCEnemy.generated.h"

class UAnimSequence;

UENUM(BlueprintType)
enum class EFCEnemyType : uint8 { Grunt, Heavy, Sniper, Boss };

// Ashen Tide militia: view cone + line of sight detection with a suspicion meter, alert spreading to
// nearby squadmates, chase / strafe / burst fire, snipers that hold position, and a death animation.
UCLASS()
class FERALCOAST_API AFCEnemy : public ACharacter
{
	GENERATED_BODY()
public:
	AFCEnemy();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual float TakeDamage(float Amount, struct FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;

	void Setup(EFCEnemyType InType, float InYawDeg, bool bInStatic);
	void Alert(AActor* Target);

	UPROPERTY(EditAnywhere, BlueprintReadOnly) EFCEnemyType Type = EFCEnemyType::Grunt;
	UPROPERTY(EditAnywhere) FString ModelKey = TEXT("rebel1");
	UPROPERTY(EditAnywhere) float MeshYawOffset = -90.f;
	UPROPERTY(BlueprintReadOnly) float Health = 100.f;
	UPROPERTY(BlueprintReadOnly) float Suspicion = 0.f;   // 0..1
	UPROPERTY(BlueprintReadOnly) bool bAlerted = false;
	UPROPERTY(BlueprintReadOnly) bool bDead = false;

protected:
	APawn* FindTarget(float& OutDist, bool& bOutSees) const;
	void Shoot(APawn* Target, float Dist);
	void PlayClip(UAnimSequence* A, bool bLoop);

	UPROPERTY() UAnimSequence* AnimIdle = nullptr;
	UPROPERTY() UAnimSequence* AnimWalk = nullptr;
	UPROPERTY() UAnimSequence* AnimRun = nullptr;
	UPROPERTY() UAnimSequence* AnimShoot = nullptr;
	UPROPERTY() UAnimSequence* AnimDeath = nullptr;
	UPROPERTY() UAnimSequence* Playing = nullptr;
	UPROPERTY() AActor* LastTarget = nullptr;

	FVector Home;
	FVector Wander;
	bool bStatic = false;
	float Damage = 7.f, Accuracy = 0.5f, Range = 8500.f, Rof = 0.13f;
	int32 BurstMin = 3, BurstMax = 5;
	int32 BurstLeft = 0;
	float BurstCooldown = 1.f, ShotTimer = 0.f, LostTimer = 0.f, WanderTimer = 0.f, StrafeTimer = 0.f, StrafeDir = 1.f, DeadTime = 0.f;
};
