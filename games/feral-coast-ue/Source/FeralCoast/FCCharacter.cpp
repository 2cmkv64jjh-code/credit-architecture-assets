#include "FCCharacter.h"
#include "FCAssets.h"
#include "FCEnemy.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/InputComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Animation/AnimSequence.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/EngineTypes.h"
#include "DrawDebugHelpers.h"

AFCCharacter::AFCCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(38.f, 92.f);
	bUseControllerRotationYaw = true;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(GetCapsuleComponent());
	Camera->SetRelativeLocation(FVector(0.f, 0.f, 70.f));
	Camera->bUsePawnControlRotation = true;
	Camera->SetFieldOfView(90.f);

	Arms = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Arms"));
	Arms->SetupAttachment(Camera);
	Arms->SetOnlyOwnerSee(true);
	Arms->CastShadow = false;
	Arms->bCastDynamicShadow = false;
	Arms->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	GunStatic = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("GunStatic"));
	GunStatic->SetupAttachment(Camera);
	GunStatic->SetOnlyOwnerSee(true);
	GunStatic->CastShadow = false;
	GunStatic->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	UCharacterMovementComponent* M = GetCharacterMovement();
	M->MaxWalkSpeed = 560.f;
	M->MaxWalkSpeedCrouched = 300.f;
	M->JumpZVelocity = 520.f;
	M->AirControl = 0.25f;
	M->NavAgentProps.bCanCrouch = true;
	M->SetWalkableFloorAngle(50.f);

	// The Feral Coast arsenal (same numbers as the browser version, distances in cm)
	auto Add = [this](FName N, float Dmg, float Int, float Spr, float Rec, int32 MagS, int32 Res, float Rel, bool bAuto, float Ads, const TCHAR* Snd, const TCHAR* Vm, bool bRig, int32 Pel = 1)
	{
		FFCWeapon W; W.Name = N; W.Damage = Dmg; W.Interval = Int; W.Spread = Spr; W.AdsSpread = Spr * 0.2f; W.Recoil = Rec;
		W.MagSize = MagS; W.Mag = MagS; W.Reserve = Res; W.ReloadTime = Rel; W.bAuto = bAuto; W.AdsFov = Ads; W.Sound = Snd; W.ViewModel = Vm; W.bRig = bRig; W.Pellets = Pel;
		Weapons.Add(W);
	};
	Add(TEXT("AR-7 Carbine"), 34.f, 0.1f, 1.2f, 0.35f, 30, 150, 1.05f, true, 60.f, TEXT("rifle"), TEXT("fpsAKM"), true);
	Add(TEXT("Whisper .45"), 40.f, 0.22f, 0.9f, 0.6f, 12, 48, 0.85f, false, 70.f, TEXT("silenced"), TEXT("fpsGlock"), true);
	Add(TEXT("Breacher Shotgun"), 16.f, 0.8f, 4.5f, 2.2f, 6, 24, 1.4f, false, 70.f, TEXT("shotgun"), TEXT("gunShotgun"), false, 9);
	Add(TEXT("Longreach Sniper"), 120.f, 1.1f, 2.5f, 3.f, 5, 20, 1.5f, false, 18.f, TEXT("sniper"), TEXT("gunSniper"), false);
}

void AFCCharacter::BeginPlay()
{
	Super::BeginPlay();
	Health = MaxHealth;
	BaseFov = Camera->FieldOfView;
	RefreshViewModel();
}

void AFCCharacter::SetupPlayerInputComponent(UInputComponent* In)
{
	Super::SetupPlayerInputComponent(In);
	In->BindAxis(TEXT("MoveForward"), this, &AFCCharacter::MoveForward);
	In->BindAxis(TEXT("MoveRight"), this, &AFCCharacter::MoveRight);
	In->BindAxis(TEXT("Turn"), this, &APawn::AddControllerYawInput);
	In->BindAxis(TEXT("LookUp"), this, &APawn::AddControllerPitchInput);
	In->BindAxis(TEXT("TurnRate"), this, &AFCCharacter::TurnRate);
	In->BindAxis(TEXT("LookUpRate"), this, &AFCCharacter::LookUpRate);
	In->BindAction(TEXT("Jump"), IE_Pressed, this, &ACharacter::Jump);
	In->BindAction(TEXT("Jump"), IE_Released, this, &ACharacter::StopJumping);
	In->BindAction(TEXT("Fire"), IE_Pressed, this, &AFCCharacter::FirePressed);
	In->BindAction(TEXT("Fire"), IE_Released, this, &AFCCharacter::FireReleased);
	In->BindAction(TEXT("Aim"), IE_Pressed, this, &AFCCharacter::AimPressed);
	In->BindAction(TEXT("Aim"), IE_Released, this, &AFCCharacter::AimReleased);
	In->BindAction(TEXT("Sprint"), IE_Pressed, this, &AFCCharacter::SprintPressed);
	In->BindAction(TEXT("Sprint"), IE_Released, this, &AFCCharacter::SprintReleased);
	In->BindAction(TEXT("Crouch"), IE_Pressed, this, &AFCCharacter::CrouchToggle);
	In->BindAction(TEXT("Reload"), IE_Pressed, this, &AFCCharacter::Reload);
	In->BindAction(TEXT("NextWeapon"), IE_Pressed, this, &AFCCharacter::NextWeapon);
	In->BindAction(TEXT("PrevWeapon"), IE_Pressed, this, &AFCCharacter::PrevWeapon);
	In->BindAction(TEXT("Weapon1"), IE_Pressed, this, &AFCCharacter::Select1);
	In->BindAction(TEXT("Weapon2"), IE_Pressed, this, &AFCCharacter::Select2);
	In->BindAction(TEXT("Weapon3"), IE_Pressed, this, &AFCCharacter::Select3);
	In->BindAction(TEXT("Weapon4"), IE_Pressed, this, &AFCCharacter::Select4);
}

void AFCCharacter::MoveForward(float V) { if (V != 0.f && !bDowned) AddMovementInput(FRotationMatrix(FRotator(0.f, GetControlRotation().Yaw, 0.f)).GetUnitAxis(EAxis::X), V); }
void AFCCharacter::MoveRight(float V) { if (V != 0.f && !bDowned) AddMovementInput(FRotationMatrix(FRotator(0.f, GetControlRotation().Yaw, 0.f)).GetUnitAxis(EAxis::Y), V); }
void AFCCharacter::TurnRate(float V) { AddControllerYawInput(V * 160.f * (bAiming ? 0.5f : 1.f) * GetWorld()->GetDeltaSeconds()); }
void AFCCharacter::LookUpRate(float V) { AddControllerPitchInput(V * 110.f * (bAiming ? 0.5f : 1.f) * GetWorld()->GetDeltaSeconds()); }

void AFCCharacter::CrouchToggle() { if (bIsCrouched) UnCrouch(); else Crouch(); }

void AFCCharacter::FirePressed() { bFireHeld = true; if (!Weapon().bAuto) FireOnce(); }
void AFCCharacter::FireReleased() { bFireHeld = false; }

void AFCCharacter::Reload()
{
	FFCWeapon& W = Weapons[Current];
	if (ReloadLeft > 0.f || W.Mag >= W.MagSize || W.Reserve <= 0) return;
	ReloadLeft = W.ReloadTime;
	if (USoundBase* S = FFCAssets::Sound(W.bRig && Current == 1 ? TEXT("reload_pistol") : TEXT("reload_rifle"))) UGameplayStatics::PlaySoundAtLocation(this, S, GetActorLocation(), 0.6f);
	if (W.bRig) PlayArms(TEXT("Reload"), false, 2.6f / W.ReloadTime);
}

void AFCCharacter::NextWeapon() { SelectWeapon((Current + 1) % Weapons.Num()); }
void AFCCharacter::PrevWeapon() { SelectWeapon((Current + Weapons.Num() - 1) % Weapons.Num()); }
void AFCCharacter::SelectWeapon(int32 Index)
{
	if (!Weapons.IsValidIndex(Index) || Index == Current) return;
	Current = Index; ReloadLeft = 0.f; FireCooldown = 0.3f;
	RefreshViewModel();
}

void AFCCharacter::RefreshViewModel()
{
	const FFCWeapon& W = Weapon();
	Arms->SetVisibility(false); GunStatic->SetVisibility(false);
	if (W.bRig)
	{
		if (USkeletalMesh* SK = FFCAssets::SkeletalMesh(W.ViewModel))
		{
			Arms->SetSkeletalMesh(SK);
			Arms->SetRelativeScale3D(FVector(1.f));
			const float Len = FMath::Max(SK->GetBounds().GetBox().GetSize().GetMax(), 1.f);
			// the whole rig (arms + gun) is ~2.3x the gun's length in the FPS pack
			const float S = ArmsGunLengthCm * 2.3f / Len;
			Arms->SetRelativeScale3D(FVector(S));
			Arms->SetRelativeLocationAndRotation(ArmsOffset, ArmsRotation);
			Arms->SetVisibility(true);
			ArmsClip.Empty();
			PlayArms(TEXT("Idle"), true);
		}
	}
	else if (UStaticMesh* SM = FFCAssets::StaticMesh(W.ViewModel))
	{
		GunStatic->SetStaticMesh(SM);
		const float S = FFCAssets::FitScale(SM->GetBoundingBox(), W.Name == TEXT("Longreach Sniper") ? 75.f : 65.f, true);
		GunStatic->SetRelativeScale3D(FVector(S));
		GunStatic->SetRelativeLocationAndRotation(FVector(35.f, 14.f, -16.f), FRotator(0.f, 90.f, 0.f));
		GunStatic->SetVisibility(true);
	}
}

void AFCCharacter::PlayArms(const FString& Clip, bool bLoop, float Rate)
{
	if (!Weapon().bRig || (ArmsClip == Clip && bLoop)) return;
	if (UAnimSequence* A = FFCAssets::Anim(Weapon().ViewModel, Clip))
	{
		Arms->PlayAnimation(A, bLoop);
		Arms->SetPlayRate(Rate);
		ArmsClip = Clip;
	}
}

void AFCCharacter::FireOnce()
{
	FFCWeapon& W = Weapons[Current];
	if (bDowned || FireCooldown > 0.f || ReloadLeft > 0.f) return;
	if (W.Mag <= 0) { Reload(); return; }
	W.Mag--;
	FireCooldown = W.Interval;
	Kick = 1.f;

	const FVector Eye = Camera->GetComponentLocation();
	const FRotator Aim = GetControlRotation();
	const float Spread = FMath::Lerp(W.Spread, W.AdsSpread, AimAlpha) * (GetVelocity().Size2D() > 50.f ? 1.6f : 1.f) * (bIsCrouched ? 0.7f : 1.f);
	FCollisionQueryParams Q(SCENE_QUERY_STAT(FCFire), true, this);
	bool bAnyHit = false;
	for (int32 P = 0; P < W.Pellets; ++P)
	{
		const FVector Dir = FMath::VRandCone(Aim.Vector(), FMath::DegreesToRadians(Spread));
		FHitResult Hit;
		if (GetWorld()->LineTraceSingleByChannel(Hit, Eye, Eye + Dir * W.Range, ECC_Visibility, Q))
		{
			AActor* A = Hit.GetActor();
			if (A && A->CanBeDamaged() && A != this)
			{
				const bool bHead = (A->IsA<ACharacter>() && Hit.ImpactPoint.Z > A->GetActorLocation().Z + 55.f);
				UGameplayStatics::ApplyPointDamage(A, W.Damage * (bHead ? 2.5f : 1.f), Dir, Hit, GetController(), this, UDamageType::StaticClass());
				bAnyHit = true;
				if (USoundBase* S = FFCAssets::Sound(TEXT("hit_soft0"))) UGameplayStatics::PlaySoundAtLocation(this, S, Hit.ImpactPoint, 0.5f);
			}
			else if (USoundBase* S = FFCAssets::Sound(FMath::RandBool() ? TEXT("hit_metal0") : TEXT("hit_soft1")))
			{
				UGameplayStatics::PlaySoundAtLocation(this, S, Hit.ImpactPoint, 0.4f);
			}
		}
	}
	if (bAnyHit) HitMarker = 0.25f;
	if (USoundBase* S = FFCAssets::Sound(W.Sound)) UGameplayStatics::PlaySoundAtLocation(this, S, Eye, 0.9f, FMath::FRandRange(0.95f, 1.05f));
	AddControllerPitchInput(-W.Recoil * (bIsCrouched ? 0.6f : 1.f));
	AddControllerYawInput(FMath::FRandRange(-0.25f, 0.25f) * W.Recoil);
	MakeNoise(1.f, this, Eye);
	if (W.bRig) { ArmsClip.Empty(); PlayArms(TEXT("Shoot"), false); }
}

float AFCCharacter::TakeDamage(float Amount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser)
{
	if (bDowned || Amount <= 0.f) return 0.f;
	Health -= Amount;
	SinceHurt = 0.f;
	DamageFlash = 1.f;
	if (Health <= 0.f)
	{
		Health = 0.f; bDowned = true; DownedTime = 0.f;
		UnCrouch(); Crouch();
		if (USoundBase* S = FFCAssets::Sound(TEXT("heartbeat"))) UGameplayStatics::PlaySoundAtLocation(this, S, GetActorLocation());
	}
	return Amount;
}

void AFCCharacter::Tick(float Dt)
{
	Super::Tick(Dt);
	FFCWeapon& W = Weapons[Current];
	FireCooldown -= Dt;
	HitMarker = FMath::Max(0.f, HitMarker - Dt);
	DamageFlash = FMath::Max(0.f, DamageFlash - Dt * 1.5f);
	Kick = FMath::FInterpTo(Kick, 0.f, Dt, 14.f);

	if (bFireHeld && W.bAuto) FireOnce();
	if (ReloadLeft > 0.f)
	{
		ReloadLeft -= Dt;
		if (ReloadLeft <= 0.f) { const int32 Got = FMath::Min(W.MagSize - W.Mag, W.Reserve); W.Mag += Got; W.Reserve -= Got; if (W.bRig) PlayArms(TEXT("Idle"), true); }
	}
	else if (W.bRig && FireCooldown < -0.15f) PlayArms(TEXT("Idle"), true);

	// downed: self-revive after 8 s (co-op partner revive can be layered on top), full regen after 5 s safe
	if (bDowned)
	{
		DownedTime += Dt;
		if (DownedTime > 8.f) { bDowned = false; Health = MaxHealth * 0.35f; UnCrouch(); }
	}
	else
	{
		SinceHurt += Dt;
		if (SinceHurt > 5.f) Health = FMath::Min(MaxHealth, Health + 25.f * Dt);
	}

	// sprint / aim
	const bool bCanSprint = bSprint && !bAiming && !bIsCrouched && !bDowned;
	GetCharacterMovement()->MaxWalkSpeed = bDowned ? 120.f : bCanSprint ? 950.f : bAiming ? 330.f : 560.f;
	AimAlpha = FMath::FInterpTo(AimAlpha, bAiming && !bCanSprint ? 1.f : 0.f, Dt, 12.f);
	Camera->SetFieldOfView(FMath::Lerp(BaseFov, W.AdsFov, AimAlpha));

	// viewmodel: ADS pulls the gun to the centre, kick pushes it back, sprinting lowers it
	USceneComponent* VM = W.bRig ? (USceneComponent*)Arms : (USceneComponent*)GunStatic;
	const FVector Base = W.bRig ? ArmsOffset : FVector(35.f, 14.f, -16.f);
	const FVector Ads = W.bRig ? FVector(ArmsOffset.X + 2.f, 0.f, ArmsOffset.Z + 4.f) : FVector(30.f, 0.f, -10.f);
	FVector L = FMath::Lerp(Base, Ads, AimAlpha) - FVector(Kick * 3.f, 0.f, 0.f);
	if (bCanSprint) L.Z -= 6.f;
	const float Bob = GetVelocity().Size2D() > 50.f ? FMath::Sin(GetWorld()->GetTimeSeconds() * (bCanSprint ? 13.f : 9.f)) * 0.6f : 0.f;
	L.Z += Bob;
	VM->SetRelativeLocation(L);
	// hide the gun when scoped in with the sniper
	if (W.AdsFov < 25.f) VM->SetVisibility(AimAlpha < 0.85f);
}
