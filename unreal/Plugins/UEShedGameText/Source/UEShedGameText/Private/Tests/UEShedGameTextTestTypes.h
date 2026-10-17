#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "UEShedGameTextTestTypes.generated.h"

// Private reflected types for the native automation tests: transient test objects, never project
// assets or part of the Game Text actions contract.
USTRUCT()
struct FUEShedGameTextTestInfo
{
	GENERATED_BODY()

	UPROPERTY()
	FText Caption;
};

UCLASS()
class UUEShedGameTextTestObject : public UObject
{
	GENERATED_BODY()

public:
	UPROPERTY()
	FText Title;

	UPROPERTY()
	TArray<FText> Lines;

	UPROPERTY()
	FUEShedGameTextTestInfo Info;

	UPROPERTY()
	TMap<FName, FText> Labels;

	UPROPERTY()
	FText Fixed[2];

	UPROPERTY()
	int32 Count = 0;
};
