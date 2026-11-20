#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "FCHUD.generated.h"

// Per-viewport HUD (works in split screen): crosshair that opens with spread, hit marker, health bar,
// damage vignette, ammo, weapon name, downed notice, compass heading and enemy suspicion indicators.
UCLASS()
class FERALCOAST_API AFCHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
};
