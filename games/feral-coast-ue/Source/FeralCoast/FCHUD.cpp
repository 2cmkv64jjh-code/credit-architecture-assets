#include "FCHUD.h"
#include "FCCharacter.h"
#include "FCEnemy.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"

void AFCHUD::DrawHUD()
{
	Super::DrawHUD();
	AFCCharacter* P = Cast<AFCCharacter>(GetOwningPawn());
	if (!P || !Canvas) return;
	const float W = Canvas->ClipX, H = Canvas->ClipY, S = FMath::Max(0.6f, H / 1080.f);
	const float Cx = W * 0.5f, Cy = H * 0.5f;
	UFont* Font = GEngine->GetMediumFont();
	UFont* Big = GEngine->GetLargeFont();

	// damage vignette
	if (P->DamageFlash > 0.f) DrawRect(FLinearColor(0.6f, 0.f, 0.f, 0.25f * P->DamageFlash), 0, 0, W, H);

	// crosshair
	if (P->AimAlpha < 0.8f && !P->bDowned)
	{
		const float Gap = (6.f + P->Weapon().Spread * 6.f) * S * (1.f - P->AimAlpha);
		const FLinearColor C(1, 1, 1, 0.85f);
		DrawLine(Cx - Gap - 9 * S, Cy, Cx - Gap, Cy, C, 2.f); DrawLine(Cx + Gap, Cy, Cx + Gap + 9 * S, Cy, C, 2.f);
		DrawLine(Cx, Cy - Gap - 9 * S, Cx, Cy - Gap, C, 2.f); DrawLine(Cx, Cy + Gap, Cx, Cy + Gap + 9 * S, C, 2.f);
	}
	if (P->HitMarker > 0.f)
	{
		const FLinearColor C(1, 0.3f, 0.25f, P->HitMarker * 4.f);
		const float a = 6 * S, b = 14 * S;
		DrawLine(Cx - b, Cy - b, Cx - a, Cy - a, C, 2.f); DrawLine(Cx + a, Cy - a, Cx + b, Cy - b, C, 2.f);
		DrawLine(Cx - b, Cy + b, Cx - a, Cy + a, C, 2.f); DrawLine(Cx + a, Cy + a, Cx + b, Cy + b, C, 2.f);
	}

	// health
	const float Bw = 300.f * S, Bh = 12.f * S, Bx = 40.f * S, By = H - 60.f * S;
	DrawRect(FLinearColor(0, 0, 0, 0.5f), Bx - 3, By - 3, Bw + 6, Bh + 6);
	DrawRect(P->Health < P->MaxHealth * 0.3f ? FLinearColor(0.9f, 0.25f, 0.2f) : FLinearColor(0.25f, 0.85f, 0.75f), Bx, By, Bw * P->Health / P->MaxHealth, Bh);
	DrawText(FString::Printf(TEXT("ROOK  ·  %d kills"), P->Kills), FLinearColor(0.25f, 0.85f, 0.75f), Bx, By - 28 * S, Font, S);

	// weapon + ammo
	const FFCWeapon& Wp = P->Weapon();
	DrawText(Wp.Name.ToString(), FLinearColor::White, W - 320 * S, H - 96 * S, Font, S);
	DrawText(FString::Printf(TEXT("%d / %d"), Wp.Mag, Wp.Reserve), Wp.Mag == 0 ? FLinearColor(1, 0.4f, 0.3f) : FLinearColor::White, W - 320 * S, H - 70 * S, Big, S * 1.3f);
	if (P->ReloadLeft > 0.f) DrawText(TEXT("RELOADING"), FLinearColor(1, 0.8f, 0.3f), Cx - 50 * S, Cy + 40 * S, Font, S);

	// compass
	const float Yaw = FRotator::NormalizeAxis(P->GetControlRotation().Yaw);
	static const TCHAR* Dirs[] = { TEXT("N"), TEXT("NE"), TEXT("E"), TEXT("SE"), TEXT("S"), TEXT("SW"), TEXT("W"), TEXT("NW") };
	DrawRect(FLinearColor(0, 0, 0, 0.4f), Cx - 220 * S, 16 * S, 440 * S, 26 * S);
	for (int32 i = 0; i < 8; ++i)
	{
		// game north = -Y in Unreal (three.js -Z)
		const float A = FRotator::NormalizeAxis(-90.f + i * 45.f - Yaw);
		if (FMath::Abs(A) < 80.f) DrawText(Dirs[i], i == 0 ? FLinearColor(1, 0.8f, 0.3f) : FLinearColor::White, Cx + A / 80.f * 210 * S - 6 * S, 18 * S, Font, S);
	}

	// suspicion / alert markers above militia that are noticing you
	for (TActorIterator<AFCEnemy> It(GetWorld()); It; ++It)
	{
		AFCEnemy* E = *It;
		if (E->bDead || (E->Suspicion <= 0.02f && !E->bAlerted)) continue;
		if (FVector::Dist(E->GetActorLocation(), P->GetActorLocation()) > 12000.f) continue;
		const FVector Sp = Project(E->GetActorLocation() + FVector(0, 0, 130.f));
		if (Sp.Z <= 0.f) continue;
		const FLinearColor C = E->bAlerted ? FLinearColor(1, 0.25f, 0.2f) : FLinearColor(1, 0.85f, 0.3f, 0.4f + E->Suspicion * 0.6f);
		DrawText(E->bAlerted ? TEXT("!") : TEXT("?"), C, Sp.X - 4 * S, Sp.Y - 20 * S, Big, S);
		if (!E->bAlerted) DrawRect(C, Sp.X - 15 * S, Sp.Y + 6 * S, 30 * S * E->Suspicion, 4 * S);
	}

	if (P->bDowned) DrawText(TEXT("DOWN — recovering..."), FLinearColor(1, 0.4f, 0.35f), Cx - 110 * S, Cy - 80 * S, Big, S);
}
