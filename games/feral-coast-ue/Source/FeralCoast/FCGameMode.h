#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "FCGameMode.generated.h"

// Spawns the second local player for split-screen co-op (keyboard/mouse = player 1, first gamepad =
// player 2 with bOffsetPlayerGamepadIds) and keeps a simple outposts-liberated score.
UCLASS()
class FERALCOAST_API AFCGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	AFCGameMode();
	virtual void BeginPlay() override;
	UPROPERTY(EditAnywhere, Category = "Co-op") bool bLocalCoop = true;
};
