#include "FCEnemy.h"
#include "FCAssets.h"
#include "FCCharacter.h"
#include "AIController.h"
#include "Animation/AnimSequence.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/EngineTypes.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"

AFCEnemy::AFCEnemy()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(36.f, 90.f);
	AIControllerClass = AAIController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	bUseControllerRotationYaw = false;
	GetCharacterMovement()->bOrientRotationToMovement = false;
	GetCharacterMovement()->MaxWalkSpeed = 160.f;
	GetMesh()->SetCollisionProfileName(TEXT("CharacterMesh"));
	GetMesh()->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
	GetMesh()->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::OnlyTickPoseWhenRendered;
}

void AFCEnemy::Setup(EFCEnemyType InType, float InYawDeg, bool bInStatic)
{
	Type = InType; bStatic = bInStatic;
	SetActorRotation(FRotator(0.f, InYawDeg, 0.f));
	switch (Type)
	{
	case EFCEnemyType::Heavy:  Health = 260.f; Damage = 15.f; Accuracy = 0.45f; Range = 3800.f; Rof = 0.5f; BurstMin = 1; BurstMax = 2; GetCharacterMovement()->MaxWalkSpeed = 130.f; SetActorScale3D(FVector(1.16f)); break;
	case EFCEnemyType::Sniper: Health = 90.f; Damage = 34.f; Accuracy = 0.55f; Range = 26000.f; Rof = 2.8f; BurstMin = 1; BurstMax = 1; ModelKey = TEXT("rebel2"); bStatic = true; break;
	case EFCEnemyType::Boss:   Health = 900.f; Damage = 10.f; Accuracy = 0.6f; Range = 9500.f; Rof = 0.09f; BurstMin = 5; BurstMax = 8; SetActorScale3D(FVector(1.12f)); break;
	default: break;
	}
}

void AFCEnemy::BeginPlay()
{
	Super::BeginPlay();
	Home = GetActorLocation(); Wander = Home;
	if (USkeletalMesh* SK = FFCAssets::SkeletalMesh(ModelKey))
	{
		GetMesh()->SetSkeletalMesh(SK);
		const FBox B = SK->GetBounds().GetBox();
		const float S = FFCAssets::FitScale(B, 180.f);
		GetMesh()->SetRelativeScale3D(FVector(S));
		GetMesh()->SetRelativeLocationAndRotation(FVector(0.f, 0.f, -90.f - B.Min.Z * S), FRotator(0.f, MeshYawOffset, 0.f));
		// militia tint: darker, red-trimmed uniforms
		for (int32 i = 0; i < GetMesh()->GetNumMaterials(); ++i)
			if (UMaterialInstanceDynamic* MID = GetMesh()->CreateAndSetMaterialInstanceDynamic(i)) MID->SetVectorParameterValue(TEXT("BaseColorFactor"), FLinearColor(0.55f, 0.35f, 0.32f));
	}
	AnimIdle = FFCAssets::Anim(ModelKey, TEXT("Idle_Gun"));
	if (!AnimIdle) AnimIdle = FFCAssets::Anim(ModelKey, TEXT("Idle"));
	AnimWalk = FFCAssets::Anim(ModelKey, TEXT("Walk"));
	AnimRun = FFCAssets::Anim(ModelKey, TEXT("Run"));
	AnimShoot = FFCAssets::Anim(ModelKey, TEXT("Shoot"));
	AnimDeath = FFCAssets::Anim(ModelKey, TEXT("Death"));
	PlayClip(AnimIdle, true);
}

void AFCEnemy::PlayClip(UAnimSequence* A, bool bLoop)
{
	if (!A || A == Playing) return;
	GetMesh()->PlayAnimation(A, bLoop);
	Playing = A;
}

APawn* AFCEnemy::FindTarget(float& OutDist, bool& bOutSees) const
{
	APawn* Best = nullptr; OutDist = 1e9f; bOutSees = false;
	const FVector Eye = GetActorLocation() + FVector(0.f, 0.f, 70.f);
	for (TActorIterator<AFCCharacter> It(GetWorld()); It; ++It)
	{
		AFCCharacter* P = *It;
		if (P->bDowned) continue;
		const float D = FVector::Dist(P->GetActorLocation(), GetActorLocation());
		if (D > Range * 1.3f || D > OutDist) continue;
		const FVector To = (P->GetActorLocation() - GetActorLocation()).GetSafeNormal2D();
		const float Cone = FVector::DotProduct(GetActorForwardVector(), To);
		if (!bAlerted && Cone < 0.35f && D > 600.f) continue;          // outside the view cone
		FHitResult Hit;
		FCollisionQueryParams Q(SCENE_QUERY_STAT(FCSight), true, this);
		const bool bBlocked = GetWorld()->LineTraceSingleByChannel(Hit, Eye, P->GetActorLocation() + FVector(0.f, 0.f, P->bIsCrouched ? 30.f : 60.f), ECC_Visibility, Q) && Hit.GetActor() != P;
		if (bBlocked) continue;
		Best = P; OutDist = D; bOutSees = true;
	}
	return Best;
}

void AFCEnemy::Alert(AActor* Target)
{
	if (bDead) return;
	bAlerted = true; Suspicion = 1.f; LastTarget = Target; LostTimer = 0.f;
}

void AFCEnemy::Shoot(APawn* Target, float Dist)
{
	const FVector Muzzle = GetActorLocation() + GetActorForwardVector() * 40.f + FVector(0.f, 0.f, 55.f);
	const FVector Aim = Target->GetActorLocation() + FVector(0.f, 0.f, 40.f);
	const float Moving = Target->GetVelocity().Size2D() > 300.f ? 0.7f : 1.f;
	const float Crouched = (Cast<ACharacter>(Target) && Cast<ACharacter>(Target)->bIsCrouched) ? 0.8f : 1.f;
	const float HitChance = FMath::Clamp(Accuracy * Moving * Crouched * (1.f - Dist / (Range * 1.4f)) + 0.12f, 0.05f, 0.9f);
	if (USoundBase* S = FFCAssets::Sound(Type == EFCEnemyType::Sniper ? TEXT("sniper") : Type == EFCEnemyType::Heavy ? TEXT("shotgun") : TEXT("rifle")))
		UGameplayStatics::PlaySoundAtLocation(this, S, Muzzle, 0.8f, FMath::FRandRange(0.92f, 1.05f));
	if (FMath::FRand() < HitChance)
	{
		FHitResult Hit;
		FCollisionQueryParams Q(SCENE_QUERY_STAT(FCShot), true, this);
		if (!GetWorld()->LineTraceSingleByChannel(Hit, Muzzle, Aim, ECC_Visibility, Q) || Hit.GetActor() == Target)
			UGameplayStatics::ApplyDamage(Target, Damage, GetController(), this, UDamageType::StaticClass());
	}
	if (AnimShoot) { GetMesh()->PlayAnimation(AnimShoot, false); Playing = AnimShoot; }
}

float AFCEnemy::TakeDamage(float Amount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser)
{
	if (bDead) return 0.f;
	// heavies wear front armour
	if (Type == EFCEnemyType::Heavy && DamageCauser && FVector::DotProduct(GetActorForwardVector(), (DamageCauser->GetActorLocation() - GetActorLocation()).GetSafeNormal2D()) > 0.4f) Amount *= 0.5f;
	Health -= Amount;
	Alert(DamageCauser);
	// shots alert the squad within 30 m
	for (TActorIterator<AFCEnemy> It(GetWorld()); It; ++It) if (*It != this && FVector::Dist(It->GetActorLocation(), GetActorLocation()) < 3000.f) It->Alert(DamageCauser);
	if (Health <= 0.f)
	{
		bDead = true;
		if (AFCCharacter* Killer = Cast<AFCCharacter>(DamageCauser)) Killer->Kills++;
		GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		GetCharacterMovement()->DisableMovement();
		if (AnimDeath) { GetMesh()->PlayAnimation(AnimDeath, false); Playing = AnimDeath; }
		else { GetMesh()->SetSimulatePhysics(true); }
		SetLifeSpan(120.f);
	}
	return Amount;
}

void AFCEnemy::Tick(float Dt)
{
	Super::Tick(Dt);
	if (bDead) return;
	float Dist; bool bSees;
	APawn* T = FindTarget(Dist, bSees);

	// detection: suspicion rises faster up close and when the player is standing
	if (!bAlerted)
	{
		if (T && bSees)
		{
			const ACharacter* C = Cast<ACharacter>(T);
			const float Rate = FMath::Clamp(1.6f - Dist / 4000.f, 0.15f, 1.6f) * (C && C->bIsCrouched ? 0.45f : 1.f);
			Suspicion = FMath::Min(1.f, Suspicion + Rate * Dt);
			if (Suspicion >= 1.f) { Alert(T); for (TActorIterator<AFCEnemy> It(GetWorld()); It; ++It) if (FVector::Dist(It->GetActorLocation(), GetActorLocation()) < 2500.f) It->Alert(T); }
			const FRotator Look = (T->GetActorLocation() - GetActorLocation()).Rotation();
			SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0.f, Look.Yaw, 0.f), Dt, 2.f));
		}
		else Suspicion = FMath::Max(0.f, Suspicion - Dt * 0.2f);

		// idle wander around the post
		if (!bStatic)
		{
			WanderTimer -= Dt;
			if (WanderTimer <= 0.f) { WanderTimer = FMath::FRandRange(4.f, 9.f); Wander = Home + FVector(FMath::FRandRange(-900.f, 900.f), FMath::FRandRange(-900.f, 900.f), 0.f); }
			const FVector D = (Wander - GetActorLocation()) * FVector(1, 1, 0);
			if (D.Size() > 80.f)
			{
				AddMovementInput(D.GetSafeNormal(), 1.f);
				SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0.f, D.Rotation().Yaw, 0.f), Dt, 3.f));
				PlayClip(AnimWalk ? AnimWalk : AnimIdle, true);
			}
			else PlayClip(AnimIdle, true);
		}
		return;
	}

	// combat
	GetCharacterMovement()->MaxWalkSpeed = Type == EFCEnemyType::Heavy ? 360.f : 460.f;
	if (T && bSees)
	{
		LastTarget = T; LostTimer = 0.f;
		const FRotator Look = (T->GetActorLocation() - GetActorLocation()).Rotation();
		SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0.f, Look.Yaw, 0.f), Dt, 6.f));
		// keep a fighting distance and strafe while shooting
		if (!bStatic)
		{
			StrafeTimer -= Dt;
			if (StrafeTimer <= 0.f) { StrafeTimer = FMath::FRandRange(1.f, 2.5f); StrafeDir = FMath::RandBool() ? 1.f : -1.f; }
			const float Want = Type == EFCEnemyType::Heavy ? 1200.f : 2200.f;
			const FVector Fwd = GetActorForwardVector();
			const FVector Side = FVector::CrossProduct(FVector::UpVector, Fwd);
			const float Close = Dist > Want * 1.3f ? 1.f : Dist < Want * 0.6f ? -1.f : 0.f;
			AddMovementInput(Fwd * Close + Side * StrafeDir * 0.6f, 1.f);
		}
		// burst fire
		BurstCooldown -= Dt; ShotTimer -= Dt;
		if (Dist < Range)
		{
			if (BurstLeft <= 0 && BurstCooldown <= 0.f) { BurstLeft = FMath::RandRange(BurstMin, BurstMax); BurstCooldown = FMath::FRandRange(0.8f, 1.8f); }
			if (BurstLeft > 0 && ShotTimer <= 0.f) { ShotTimer = Rof; BurstLeft--; Shoot(T, Dist); }
		}
		if (!Playing || Playing == AnimIdle || Playing == AnimWalk) PlayClip(GetVelocity().Size2D() > 50.f ? (AnimRun ? AnimRun : AnimWalk) : AnimIdle, true);
	}
	else if (LastTarget && !bStatic)
	{
		// lost sight: push to the last known position, then search
		LostTimer += Dt;
		const FVector D = (LastTarget->GetActorLocation() - GetActorLocation()) * FVector(1, 1, 0);
		if (LostTimer < 12.f && D.Size() > 300.f)
		{
			AddMovementInput(D.GetSafeNormal(), 1.f);
			SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0.f, D.Rotation().Yaw, 0.f), Dt, 4.f));
			PlayClip(AnimRun ? AnimRun : AnimWalk, true);
		}
		else PlayClip(AnimIdle, true);
		if (LostTimer > 30.f) { bAlerted = false; Suspicion = 0.5f; }
	}
}
