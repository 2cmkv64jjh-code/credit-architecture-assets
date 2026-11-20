#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "FCCharacter.generated.h"

class UCameraComponent;
class USkeletalMeshComponent;
class UStaticMeshComponent;
class UAnimSequence;

USTRUCT(BlueprintType)
struct FFCWeapon
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere) FName Name;
	UPROPERTY(EditAnywhere) float Damage = 30.f;
	UPROPERTY(EditAnywhere) float Interval = 0.1f;      // seconds between shots
	UPROPERTY(EditAnywhere) float Spread = 0.6f;        // degrees, hip fire
	UPROPERTY(EditAnywhere) float AdsSpread = 0.1f;
	UPROPERTY(EditAnywhere) float Recoil = 0.35f;       // degrees of pitch per shot
	UPROPERTY(EditAnywhere) float Range = 30000.f;      // cm
	UPROPERTY(EditAnywhere) int32 Pellets = 1;
	UPROPERTY(EditAnywhere) int32 MagSize = 30;
	UPROPERTY(EditAnywhere) int32 Mag = 30;
	UPROPERTY(EditAnywhere) int32 Reserve = 120;
	UPROPERTY(EditAnywhere) float ReloadTime = 1.05f;
	UPROPERTY(EditAnywhere) bool bAuto = true;
	UPROPERTY(EditAnywhere) float AdsFov = 55.f;
	UPROPERTY(EditAnywhere) FString Sound = TEXT("rifle");
	UPROPERTY(EditAnywhere) FString ViewModel;          // model folder key of an animated FPS rig, or a static gun
	UPROPERTY(EditAnywhere) bool bRig = false;
};

// First-person player: movement (sprint / crouch / jump), hitscan weapons with ADS and recoil,
// animated first-person arms, health with regeneration, and a downed state. Works for any local player.
UCLASS()
class FERALCOAST_API AFCCharacter : public ACharacter
{
	GENERATED_BODY()
public:
	AFCCharacter();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
	virtual float TakeDamage(float Amount, struct FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UCameraComponent* Camera;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) USkeletalMeshComponent* Arms;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly) UStaticMeshComponent* GunStatic;

	// Viewmodel placement relative to the camera; tune in the Details panel if the arms sit wrong.
	UPROPERTY(EditAnywhere, Category = "Viewmodel") FVector ArmsOffset = FVector(10.f, 4.f, -12.f);
	UPROPERTY(EditAnywhere, Category = "Viewmodel") FRotator ArmsRotation = FRotator(0.f, -90.f, 0.f);
	UPROPERTY(EditAnywhere, Category = "Viewmodel") float ArmsGunLengthCm = 62.f;

	UPROPERTY(EditAnywhere, Category = "Weapons") TArray<FFCWeapon> Weapons;
	UPROPERTY(BlueprintReadOnly) int32 Current = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float MaxHealth = 150.f;
	UPROPERTY(BlueprintReadOnly) float Health = 150.f;
	UPROPERTY(BlueprintReadOnly) float ReloadLeft = 0.f;
	UPROPERTY(BlueprintReadOnly) float HitMarker = 0.f;
	UPROPERTY(BlueprintReadOnly) float DamageFlash = 0.f;
	UPROPERTY(BlueprintReadOnly) bool bDowned = false;
	UPROPERTY(BlueprintReadOnly) float AimAlpha = 0.f;
	UPROPERTY(BlueprintReadOnly) int32 Kills = 0;

	const FFCWeapon& Weapon() const { return Weapons[Current]; }

protected:
	void MoveForward(float V);
	void MoveRight(float V);
	void TurnRate(float V);
	void LookUpRate(float V);
	void FirePressed();
	void FireReleased();
	void AimPressed() { bAiming = true; }
	void AimReleased() { bAiming = false; }
	void SprintPressed() { bSprint = true; }
	void SprintReleased() { bSprint = false; }
	void CrouchToggle();
	void Reload();
	void NextWeapon();
	void PrevWeapon();
	void SelectWeapon(int32 Index);
	void Select1() { SelectWeapon(0); }
	void Select2() { SelectWeapon(1); }
	void Select3() { SelectWeapon(2); }
	void Select4() { SelectWeapon(3); }

	void FireOnce();
	void RefreshViewModel();
	void PlayArms(const FString& Clip, bool bLoop, float Rate = 1.f);

	bool bFireHeld = false;
	bool bAiming = false;
	bool bSprint = false;
	float FireCooldown = 0.f;
	float SinceHurt = 10.f;
	float DownedTime = 0.f;
	float BaseFov = 90.f;
	float Kick = 0.f;
	FString ArmsClip;
};
