#pragma once

#include "Commandlets/Commandlet.h"
#include "UEShedGameTextCommandlet.generated.h"

/**
 * Headless Game Text actions: `-run=UEShedGameText -Request=<request.json> -Result=<result.json>`.
 * Runs the same `ue-shed-game-text-actions` request as Remote Control and exits 0 only when the
 * result's status is `ok`.
 */
UCLASS()
class UESHEDGAMETEXT_API UUEShedGameTextCommandlet : public UCommandlet
{
	GENERATED_BODY()

public:
	UUEShedGameTextCommandlet();
	virtual int32 Main(const FString& Params) override;
};
