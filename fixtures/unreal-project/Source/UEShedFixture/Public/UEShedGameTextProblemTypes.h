#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "UEShedGameTextProblemTypes.generated.h"

/**
 * Text in a struct that serializes itself. Unreal's gather walks the struct's properties and
 * collects its text; the saved-package reader cannot decode the struct's bytes, so the package is
 * only partly read.
 */
USTRUCT()
struct UESHEDFIXTURE_API FUEShedFixtureNativeText
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Fixture")
	FText Label;

	bool Serialize(FArchive& Ar)
	{
		Ar << Label;
		return true;
	}
};

template <> struct TStructOpsTypeTraits<FUEShedFixtureNativeText> : TStructOpsTypeTraitsBase2<FUEShedFixtureNativeText>
{
	enum
	{
		WithSerializer = true
	};
};

UCLASS(BlueprintType)
class UESHEDFIXTURE_API UUEShedFixtureNativeTextAsset : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Fixture")
	FUEShedFixtureNativeText Reward;

	UPROPERTY(EditAnywhere, Category = "Fixture")
	FText Title;
};
