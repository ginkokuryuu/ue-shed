#include "Serialization/JsonInternationalizationManifestSerializer.h"
#include "Serialization/JsonInternationalizationArchiveSerializer.h"
#include "Misc/FeedbackContext.h"

static bool VerifyWtf8LocalizationAcceptance()
{
	if (GWarn->GetNumErrors() != 0) return false;
	for (const TCHAR* Escaped : { TEXT("\\ud800"), TEXT("\\udfff"), TEXT("\\udfff\\ud800"), TEXT("\\ud800\\udc00") })
	{
		const FString ManifestJson = FString::Printf(TEXT("{\"FormatVersion\":1,\"Namespace\":\"UI\",\"Children\":[{\"Source\":{\"Text\":\"%s\"},\"Keys\":[{\"Key\":\"K\",\"Path\":\"Source/Test.cpp:1\"}]}]}"), Escaped);
		const FString ArchiveJson = FString::Printf(TEXT("{\"FormatVersion\":2,\"Namespace\":\"UI\",\"Children\":[{\"Key\":\"K\",\"Source\":{\"Text\":\"%s\"},\"Translation\":{\"Text\":\"Translation\"}}]}"), Escaped);
		const bool Expected = FCString::Strcmp(Escaped, TEXT("\\ud800\\udc00")) == 0;
		const bool ManifestAccepted = FJsonInternationalizationManifestSerializer::DeserializeManifestFromString(ManifestJson, MakeShared<FInternationalizationManifest>());
		const bool ArchiveAccepted = FJsonInternationalizationArchiveSerializer::DeserializeArchiveFromString(ArchiveJson, MakeShared<FInternationalizationArchive>(), nullptr, nullptr);
		if (ManifestAccepted != Expected || ArchiveAccepted != Expected)
		{
			UE_LOG(LogTemp, Error, TEXT("WTF-8 acceptance mismatch: manifest=%d archive=%d expected=%d"), ManifestAccepted, ArchiveAccepted, Expected);
			return false;
		}
	}
	// The six intentionally rejected loader calls log errors. Verify their exact count before
	// clearing the isolated probe's history so the commandlet can report the asserted result.
	if (GWarn->GetNumErrors() != 6) return false;
	GWarn->ClearWarningsAndErrors();
	UE_LOG(LogTemp, Display, TEXT("WTF-8 engine evidence: 6 expected rejections, 2 paired-escape accepts; lone lead, lone trail and trail-then-lead rejected by both localization loaders."));
	return true;
}
