#include "FCGameMode.h"
#include "FCCharacter.h"
#include "FCHUD.h"
#include "Kismet/GameplayStatics.h"

AFCGameMode::AFCGameMode()
{
	DefaultPawnClass = AFCCharacter::StaticClass();
	HUDClass = AFCHUD::StaticClass();
}

void AFCGameMode::BeginPlay()
{
	Super::BeginPlay();
	if (bLocalCoop && UGameplayStatics::GetNumLocalPlayerControllers(this) < 2)
		UGameplayStatics::CreatePlayer(this, 1, /*bSpawnPlayerController*/ true);
}
