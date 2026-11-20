#include "FCGameMode.h"
#include "FCCharacter.h"
#include "FCHUD.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/GameInstance.h"

AFCGameMode::AFCGameMode()
{
	DefaultPawnClass = AFCCharacter::StaticClass();
	HUDClass = AFCHUD::StaticClass();
}

void AFCGameMode::BeginPlay()
{
	Super::BeginPlay();
	if (bLocalCoop && GetGameInstance() && GetGameInstance()->GetNumLocalPlayers() < 2)
		UGameplayStatics::CreatePlayer(this, 1, /*bSpawnPlayerController*/ true);
}
