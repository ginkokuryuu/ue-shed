#include "UEShedGameTextLibrary.h"

#include "UEShedGameTextActions.h"

void UUEShedGameTextLibrary::ApplyTextActions(const FString& RequestJson, FString& ResultJson)
{
	ResultJson = UEShedGameText::ApplyTextActions(RequestJson);
}
