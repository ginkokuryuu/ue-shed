#pragma once

#include "CoreMinimal.h"

namespace UEShedGameText
{
/** Runs one `ue-shed-game-text-actions` 1.0 request and returns its result JSON (ADR 0011). */
UESHEDGAMETEXT_API FString ApplyTextActions(const FString& RequestJson);

/** Whether a result JSON reports `status: "ok"`. */
UESHEDGAMETEXT_API bool IsOkResult(const FString& ResultJson);
}
