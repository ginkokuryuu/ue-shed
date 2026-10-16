#include "UEShedGameTextProblemsFixture.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Blueprint/WidgetBlueprintGeneratedClass.h"
#include "Blueprint/UserWidget.h"
#include "Blueprint/WidgetTree.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Dom/JsonObject.h"
#include "EdGraphSchema_K2.h"
#include "Engine/DataTable.h"
#include "HAL/FileManager.h"
#include "Internationalization/StringTable.h"
#include "Internationalization/StringTableCore.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "LocalizationConfigurationScript.h"
#include "LocalizationSettings.h"
#include "LocTextHelper.h"
#include "Misc/EngineVersionComparison.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "PortableObjectFormatDOM.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "UEShedFixtureTypes.h"
#include "UEShedGameTextProblemTypes.h"
#include "WidgetBlueprint.h"

// Each case is listed in the fixture README ("Game Text problem cases") and asserted through
// FixtureSource/GameTextProblems/expected-cases.json. Every stage runs in a fresh process.
namespace
{
const TCHAR* TargetName = TEXT("Game");
const TCHAR* Root = TEXT("/Game/Fixture/GameTextProblems");
const TCHAR* LinesNamespace = TEXT("Fixture.GameTextProblems.Lines");
const TCHAR* MenuNamespace = TEXT("Fixture.GameTextProblems.Menu");
const TCHAR* ItemsNamespace = TEXT("Fixture.GameTextProblems.Items");
const TCHAR* QuestsNamespace = TEXT("Fixture.GameTextProblems.Quests");
const TCHAR* WidgetsNamespace = TEXT("Fixture.GameTextProblems.Widgets");
const TCHAR* RewardsNamespace = TEXT("Fixture.GameTextProblems.Rewards");
const TCHAR* ExcludedNamespace = TEXT("Fixture.GameTextProblems.Excluded");
const TArray<FString> ForeignCultures = { TEXT("de"), TEXT("fr"), TEXT("ja") };

/** `ST_X` -> `/Game/Fixture/GameTextProblems/ST_X.ST_X`; `Excluded/DA_X` keeps its folder. */
FString ObjectPath(const FString& Name)
{
	return FString(Root) / Name + TEXT(".") + FPaths::GetCleanFilename(Name);
}

FString DataDirectory()
{
	return FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir() / TEXT("Localization") / TargetName);
}

FString POPath(const FString& Culture)
{
	return DataDirectory() / Culture / (FString(TargetName) + TEXT(".po"));
}

bool Save(UObject* Asset)
{
	UPackage* Package = Asset->GetOutermost();
	Package->MarkPackageDirty();
	const FString Filename = FPackageName::LongPackageNameToFilename(
		Package->GetName(), FPackageName::GetAssetPackageExtension());
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(Filename), true);
	FSavePackageArgs Args;
	Args.TopLevelFlags = RF_Public | RF_Standalone;
	Args.SaveFlags = SAVE_NoError;
	return UPackage::SavePackage(Package, Asset, *Filename, Args);
}

template <typename T> T* CreateAsset(const FString& Path)
{
	UPackage* Package = CreatePackage(*FPackageName::ObjectPathToPackageName(Path));
	T* Asset = NewObject<T>(Package, *FPackageName::ObjectPathToObjectName(Path),
		RF_Public | RF_Standalone | RF_Transactional);
	FAssetRegistryModule::AssetCreated(Asset);
	return Asset;
}

FText Text(const TCHAR* Namespace, const TCHAR* Key, const FString& Source)
{
	return FText::ChangeKey(FTextKey(Namespace), FTextKey(Key), FText::FromString(Source));
}

void SetString(const FStringTableRef& Table, const TCHAR* Key, const FString& Source,
	const FString& Notes = FString())
{
#if UE_VERSION_OLDER_THAN(5, 8, 0)
	Table->SetSourceString(FTextKey(Key), Source);
#else
	Table->SetSourceString(FTextKey(Key), Source, Notes);
#endif
	if (!Notes.IsEmpty()) Table->SetMetaData(FTextKey(Key), TEXT("Comment"), Notes);
}

UStringTable* NewTable(const FString& Name, const TCHAR* Namespace)
{
	UStringTable* Strings = CreateAsset<UStringTable>(ObjectPath(Name));
	FStringTableRef Table = Strings->GetMutableStringTable();
	Table->ClearSourceStrings();
	Table->ClearMetaData();
	Table->SetNamespace(FTextKey(Namespace));
	return Strings;
}

bool Lines()
{
	UStringTable* Strings = NewTable(TEXT("ST_FixtureProblemLines"), LinesNamespace);
	FStringTableRef Table = Strings->GetMutableStringTable();
	// Notes and clean translations: no finding.
	SetString(Table, TEXT("Clean"), TEXT("Start the voyage"), TEXT("Button on the title screen."));
	// Translation checks: a German, French or Japanese translation carries the problem.
	SetString(Table, TEXT("RenamedArgument"), TEXT("Buy {Quantity} apples"));
	SetString(Table, TEXT("DroppedArgument"), TEXT("{Name} found {Count} coins"));
	SetString(Table, TEXT("AddedArgument"), TEXT("Welcome back"));
	SetString(Table, TEXT("OptionalArgument"), TEXT("Thanks for the help!"));
	SetString(Table, TEXT("MissingTag"), TEXT("Press <Key>E</> to open"));
	SetString(Table, TEXT("AddedTag"), TEXT("Plain words here"));
	SetString(Table, TEXT("TagCase"), TEXT("<Italic>Note</>"));
	SetString(Table, TEXT("OptionalTag"), TEXT("Hello, traveller"));
	SetString(Table, TEXT("UnbalancedTag"), TEXT("<Em>Continue</>"));
	SetString(Table, TEXT("Separator"), TEXT("Yes // No"));
	SetString(Table, TEXT("EdgeWhitespace"), TEXT("Ready"));
	SetString(Table, TEXT("LineBreak"), TEXT("First line\nSecond line"));
	SetString(Table, TEXT("LengthOutlier"), TEXT("Collect the lantern before nightfall"));
	SetString(Table, TEXT("PlaceholderTranslation"), TEXT("Return to the harbour"));
	SetString(Table, TEXT("EmptyTranslation"), TEXT("Open the map"));
	SetString(Table, TEXT("PoEscape"), TEXT("Two lines of help"));
	// Translated, then changed before the last gather (the Outdate stage): new words, and only
	// CRLF changed to LF.
	SetString(Table, TEXT("Beacon"), TEXT("Light the beacon"));
	SetString(Table, TEXT("TornPage"), TEXT("Torn page\r\nA scrap of the map"));
	// One short UI text under three keys; German translates one of them differently.
	SetString(Table, TEXT("BackFromMap"), TEXT("Back"));
	SetString(Table, TEXT("BackFromShop"), TEXT("Back"));
	SetString(Table, TEXT("BackFromInventory"), TEXT("Back"));
	// Source checks, left untranslated.
	SetString(Table, TEXT("PlaceholderTodo"), TEXT("TODO: final quest name"));
	SetString(Table, TEXT("PlaceholderLorem"), TEXT("Lorem ipsum dolor sit amet"));
	SetString(Table, TEXT("PlaceholderPending"), TEXT("(To be translated)"));
	SetString(Table, TEXT("MarkupUnclosedTag"), TEXT("Unclosed <Em>tag"));
	SetString(Table, TEXT("MarkupXmlClosing"), TEXT("<b>Bold</b> move"));
	SetString(Table, TEXT("SourceEdgeSpace"), TEXT(" Leading space"));
	SetString(Table, TEXT("SourceDoubleSpace"), TEXT("Double  space"));
	return Save(Strings);
}

bool Menus()
{
	// Two tables declare one namespace and both have the key Resume, with different text.
	UStringTable* First = NewTable(TEXT("ST_FixtureMenuA"), MenuNamespace);
	SetString(First->GetMutableStringTable(), TEXT("Resume"), TEXT("Resume"));
	SetString(First->GetMutableStringTable(), TEXT("Options"), TEXT("Options"));
	UStringTable* Second = NewTable(TEXT("ST_FixtureMenuB"), MenuNamespace);
	SetString(Second->GetMutableStringTable(), TEXT("Resume"), TEXT("Resume game"));
	SetString(Second->GetMutableStringTable(), TEXT("Quit"), TEXT("Quit to title"));
	return Save(First) && Save(Second);
}

FUEShedFixtureTextRow Row(const FText& Value)
{
	FUEShedFixtureTextRow Result;
	Result.DisplayName = Value;
	return Result;
}

UDataTable* NewRows(const FString& Name)
{
	UDataTable* Rows = CreateAsset<UDataTable>(ObjectPath(Name));
	Rows->RowStruct = FUEShedFixtureTextRow::StaticStruct();
	Rows->EmptyTable();
	return Rows;
}

bool Items()
{
	UDataTable* Rows = NewRows(TEXT("DT_FixtureItems"));
	Rows->AddRow(TEXT("Lantern"), Row(Text(ItemsNamespace, TEXT("Lantern"), TEXT("Brass lantern"))));
	Rows->AddRow(TEXT("Rope"), Row(Text(ItemsNamespace, TEXT("Rope"), TEXT("Coil of rope"))));
	Rows->AddRow(TEXT("Compass"), Row(Text(ItemsNamespace, TEXT("Compass"), TEXT("Old compass"))));
	// Re-keyed after the last gather (the AfterGather stage).
	Rows->AddRow(TEXT("Moonstone"), Row(Text(ItemsNamespace, TEXT("Moonstone"), TEXT("Moonstone relic"))));
	Rows->AddRow(TEXT("Price"), Row(Text(ItemsNamespace, TEXT("Price"), TEXT("1,000"))));
	Rows->AddRow(TEXT("Timer"), Row(Text(ItemsNamespace, TEXT("Timer"), TEXT("00:30"))));
	// Player text left culture invariant in a column every other row localizes.
	Rows->AddRow(TEXT("CellarKey"), Row(FText::AsCultureInvariant(TEXT("Rusty cellar key"))));
	return Save(Rows);
}

bool Quests()
{
	// Two rows keep one key with different text, set directly. A copy retyped in the editor would get
	// a new key instead (README, "Game Text identity cases").
	UDataTable* Rows = NewRows(TEXT("DT_FixtureQuestLog"));
	Rows->AddRow(TEXT("Intro"), Row(Text(QuestsNamespace, TEXT("QuestIntro"), TEXT("Find the lighthouse keeper"))));
	Rows->AddRow(TEXT("IntroRetold"), Row(Text(QuestsNamespace, TEXT("QuestIntro"), TEXT("Find the old lighthouse keeper"))));
	Rows->AddRow(TEXT("Outro"), Row(Text(QuestsNamespace, TEXT("QuestOutro"), TEXT("The lamp burns again"))));
	return Save(Rows);
}

/** A compiled Widget Blueprint with one text block under a vertical box. */
UWidgetBlueprint* Widget(const FString& Name, const TCHAR* Label, const TCHAR* Key, const FString& Source)
{
	UPackage* Package = CreatePackage(*FPackageName::ObjectPathToPackageName(ObjectPath(Name)));
	UWidgetBlueprint* Blueprint = Cast<UWidgetBlueprint>(FKismetEditorUtilities::CreateBlueprint(
		UUserWidget::StaticClass(), Package, *Name, BPTYPE_Normal, UWidgetBlueprint::StaticClass(),
		UWidgetBlueprintGeneratedClass::StaticClass()));
	if (!Blueprint || !Blueprint->WidgetTree) return nullptr;
	FAssetRegistryModule::AssetCreated(Blueprint);
	UVerticalBox* Box = Blueprint->WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("Root"));
	Blueprint->WidgetTree->RootWidget = Box;
	UTextBlock* Block = Blueprint->WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), Label);
	Block->SetText(Text(WidgetsNamespace, Key, Source));
	Box->AddChild(Block);
	FKismetEditorUtilities::CompileBlueprint(Blueprint);
	return Blueprint;
}

bool Objective(const FString& Name, const FString& Title)
{
	UWidgetBlueprint* Blueprint = Widget(Name, TEXT("Title"), TEXT("ObjectiveTitle"), Title);
	if (!Blueprint) return false;
	// Editor-only text, a variable category. The target does not gather editor-only data.
	FEdGraphPinType IntType;
	IntType.PinCategory = UEdGraphSchema_K2::PC_Int;
	if (!FBlueprintEditorUtils::AddMemberVariable(Blueprint, TEXT("ObjectiveCount"), IntType, TEXT("0"))) return false;
	FBlueprintEditorUtils::SetBlueprintVariableCategory(Blueprint, TEXT("ObjectiveCount"), nullptr,
		Text(WidgetsNamespace, TEXT("ObjectiveCategory"), TEXT("Objective|Display")), true);
	FKismetEditorUtilities::CompileBlueprint(Blueprint);
	return Save(Blueprint);
}

bool Widgets()
{
	// A Widget Blueprint and a branch copy of it share their text keys, and the copy's title was
	// edited on its own. A Content Browser Duplicate would give the copy new keys.
	if (!Objective(TEXT("WBP_FixtureObjective"), TEXT("Reach the lighthouse"))
		|| !Objective(TEXT("WBP_FixtureObjective_Copy"), TEXT("Reach the old lighthouse"))) return false;
	// Compiled, then edited in the designer and saved without compiling: the generated class keeps
	// the older text, which is what the game shows.
	UWidgetBlueprint* Stale = Widget(TEXT("WBP_FixtureStaleCompile"), TEXT("Hint"), TEXT("StaleHint"), TEXT("Press any key"));
	UTextBlock* Hint = Stale ? Cast<UTextBlock>(Stale->WidgetTree->FindWidget(TEXT("Hint"))) : nullptr;
	if (!Hint) return false;
	Hint->SetText(Text(WidgetsNamespace, TEXT("StaleHint"), TEXT("Press any button")));
	return Save(Stale);
}

bool OtherAssets()
{
	// Inside the excluded folder: outside the target's gather paths.
	UUEShedFixtureTextAsset* Excluded = CreateAsset<UUEShedFixtureTextAsset>(ObjectPath(TEXT("Excluded/DA_FixtureExcluded")));
	Excluded->SharedPrimary = Text(ExcludedNamespace, TEXT("OverlayLabel"), TEXT("Debug overlay label"));
	// Text in a struct that serializes itself: Unreal gathers it, the saved-package reader cannot
	// decode it, so the package is only partly read. The title next to it is read.
	UUEShedFixtureNativeTextAsset* Partial = CreateAsset<UUEShedFixtureNativeTextAsset>(ObjectPath(TEXT("DA_FixturePartlyRead")));
	Partial->Reward.Label = Text(RewardsNamespace, TEXT("RewardLabel"), TEXT("A flask of lamp oil"));
	Partial->Title = Text(RewardsNamespace, TEXT("RewardTitle"), TEXT("Reward"));
	return Save(Excluded) && Save(Partial);
}

bool GenerateConfigs()
{
	ULocalizationTargetSet* Targets = ULocalizationSettings::GetGameTargetSet();
	ULocalizationTarget* Target = nullptr;
	for (ULocalizationTarget* Candidate : Targets->TargetObjects)
	{
		if (Candidate && Candidate->Settings.Name == TargetName) Target = Candidate;
	}
	if (!Target)
	{
		Target = NewObject<ULocalizationTarget>(Targets);
		Targets->TargetObjects.Add(Target);
	}
	FLocalizationTargetSettings Settings;
	Settings.Name = TargetName;
	// The Game target every new project starts with keeps its GUID.
	Settings.Guid = FGuid(0xAE0EA34A, 0x45461A25, 0xBA65A391, 0x026F19F8);
	Settings.NativeCultureIndex = 0;
	Settings.SupportedCulturesStatistics.Add(FCultureStatistics(TEXT("en")));
	for (const FString& Culture : ForeignCultures) Settings.SupportedCulturesStatistics.Add(FCultureStatistics(Culture));
	Settings.GatherFromTextFiles.IsEnabled = false;
	Settings.GatherFromPackages.IsEnabled = true;
	FGatherTextIncludePath Content;
	Content.Pattern = TEXT("Content/Fixture/GameTextProblems/*");
	Settings.GatherFromPackages.IncludePathWildcards.Add(Content);
	FGatherTextExcludePath Excluded;
	Excluded.Pattern = TEXT("Content/Fixture/GameTextProblems/Excluded/*");
	Settings.GatherFromPackages.ExcludePathWildcards.Add(Excluded);
	Settings.GatherFromPackages.ShouldGatherFromEditorOnlyData = false;
	Settings.GatherFromPackages.SkipGatherCache = true;
	Target->Settings = Settings;
	// The Dashboard's own propagation saves +GameTargetsSettings to DefaultEditor.ini.
	GetMutableDefault<ULocalizationSettings>()->PostEditChange();
	if (!GetMutableDefault<ULocalizationSettings>()->TryUpdateDefaultConfigFile()) return false;
	IFileManager::Get().MakeDirectory(*LocalizationConfigurationScript::GetConfigDirectory(Target), true);
	// Use the generated FConfigFile directly; WriteWithSCC would invoke source-control hooks.
	return LocalizationConfigurationScript::GenerateGatherTextConfigFile(Target).Write(
		LocalizationConfigurationScript::GetGatherTextConfigPath(Target))
		&& LocalizationConfigurationScript::GenerateImportTextConfigFile(Target).Write(
			LocalizationConfigurationScript::GetImportTextConfigPath(Target))
		&& LocalizationConfigurationScript::GenerateExportTextConfigFile(Target).Write(
			LocalizationConfigurationScript::GetExportTextConfigPath(Target))
		&& LocalizationConfigurationScript::GenerateCompileTextConfigFile(Target).Write(
			LocalizationConfigurationScript::GetCompileTextConfigPath(Target))
		&& LocalizationConfigurationScript::GenerateWordCountReportConfigFile(Target).Write(
			LocalizationConfigurationScript::GetWordCountReportConfigPath(Target));
}

// UE 5.8 may key FJsonObject::Values by UE::FSharedString; both key types dereference to TCHAR.
template <typename KeyType> FString JsonKey(const KeyType& Key)
{
	return FString(*Key);
}

/** `translations` and `poOverrides`: culture -> namespace -> key -> text. */
TSharedPtr<FJsonObject> LoadInputs()
{
	FString Contents;
	TSharedPtr<FJsonObject> Result;
	if (!FFileHelper::LoadFileToString(Contents, *(FPaths::ProjectDir()
		/ TEXT("FixtureSource/GameTextProblems/translations.json")))
		|| !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Contents), Result)) return nullptr;
	for (const TCHAR* Tree : { TEXT("translations"), TEXT("poOverrides") })
	{
		const TSharedPtr<FJsonObject>* CulturesObject = nullptr;
		if (!Result->TryGetObjectField(Tree, CulturesObject)) return nullptr;
		for (const auto& Culture : (*CulturesObject)->Values)
		{
			if (!ForeignCultures.Contains(JsonKey(Culture.Key)) || Culture.Value->Type != EJson::Object) return nullptr;
			for (const auto& Namespace : Culture.Value->AsObject()->Values)
			{
				if (Namespace.Value->Type != EJson::Object) return nullptr;
				for (const auto& Key : Namespace.Value->AsObject()->Values)
					if (Key.Value->Type != EJson::String) return nullptr;
			}
		}
	}
	return Result;
}

bool Translate()
{
	const TSharedPtr<FJsonObject> Inputs = LoadInputs();
	if (!Inputs) return false;
	FLocTextHelper Helper(DataDirectory(), FString(TargetName) + TEXT(".manifest"),
		FString(TargetName) + TEXT(".archive"), TEXT("en"), ForeignCultures, nullptr);
	if (!Helper.LoadAll(ELocTextHelperLoadFlags::Load)) return false;
	for (const auto& Culture : Inputs->GetObjectField(TEXT("translations"))->Values)
	{
		const FString CultureName = JsonKey(Culture.Key);
		for (const auto& Namespace : Culture.Value->AsObject()->Values)
		{
			const FString NamespaceName = JsonKey(Namespace.Key);
			for (const auto& Key : Namespace.Value->AsObject()->Values)
			{
				const FString KeyName = JsonKey(Key.Key);
				const TSharedPtr<FManifestEntry> Entry = Helper.FindSourceText(FLocKey(NamespaceName), FLocKey(KeyName));
				const FManifestContext* Context = Entry ? Entry->FindContextByKey(FLocKey(KeyName)) : nullptr;
				if (!Context)
				{
					UE_LOG(LogTemp, Error, TEXT("No gathered source for %s,%s."), *NamespaceName, *KeyName);
					return false;
				}
				// Translated against the gathered source, as a translator's import would be.
				if (!Helper.ImportTranslation(CultureName, Entry->Namespace, Context->Key,
					Context->KeyMetadataObj, Entry->Source, FLocItem(Key.Value->AsString()), Context->bIsOptional)) return false;
			}
		}
		if (!Helper.SaveArchive(CultureName)) return false;
	}
	return true;
}

bool Unsynced()
{
	const TSharedPtr<FJsonObject> Inputs = LoadInputs();
	if (!Inputs) return false;
	for (const auto& Culture : Inputs->GetObjectField(TEXT("poOverrides"))->Values)
	{
		const FString CultureName = JsonKey(Culture.Key);
		FString Contents;
		FPortableObjectFormatDOM PO;
		if (!FFileHelper::LoadFileToString(Contents, *POPath(CultureName)) || !PO.FromString(Contents)) return false;
		for (const auto& Namespace : Culture.Value->AsObject()->Values)
		{
			for (const auto& Key : Namespace.Value->AsObject()->Values)
			{
				const FString Context = JsonKey(Namespace.Key) + TEXT(",") + JsonKey(Key.Key);
				TSharedPtr<FPortableObjectEntry> Match;
				for (auto It = PO.GetEntriesIterator(); It; ++It)
				{
					if (It.Value()->MsgCtxt == Context) Match = It.Value();
				}
				if (!Match || Match->MsgStr.Num() != 1) return false;
				Match->MsgStr[0] = Key.Value->AsString();
			}
		}
		// Unreal's PO DOM owns serialization, with the same encoding as PortableObjectPipeline.
		if (!FFileHelper::SaveStringToFile(PO.ToString(), *POPath(CultureName),
			FFileHelper::EEncodingOptions::ForceUTF8)) return false;
	}
	return true;
}

bool Outdate()
{
	UStringTable* Strings = LoadObject<UStringTable>(nullptr, *ObjectPath(TEXT("ST_FixtureProblemLines")));
	if (!Strings) return false;
	FStringTableRef Table = Strings->GetMutableStringTable();
	SetString(Table, TEXT("Beacon"), TEXT("Light both beacons"));
	SetString(Table, TEXT("TornPage"), TEXT("Torn page\nA scrap of the map"));
	return Save(Strings);
}

bool AfterGather()
{
	UDataTable* Rows = LoadObject<UDataTable>(nullptr, *ObjectPath(TEXT("DT_FixtureItems")));
	FUEShedFixtureTextRow* Moonstone = Rows ? Rows->FindRow<FUEShedFixtureTextRow>(TEXT("Moonstone"), TEXT("Fixture")) : nullptr;
	if (!Moonstone) return false;
	Moonstone->DisplayName = Text(ItemsNamespace, TEXT("MoonstoneRelic"), TEXT("Moonstone relic"));
	return Save(Rows);
}
}

bool RunGameTextProblemsFixture(const FString& Params)
{
	FString Stage;
	if (!FParse::Value(*Params, TEXT("GameTextProblemsStage="), Stage)) return false;
	if (Stage == TEXT("Initial"))
		return Lines() && Menus() && Items() && Quests() && Widgets() && OtherAssets() && GenerateConfigs();
	if (Stage == TEXT("Translate")) return Translate();
	if (Stage == TEXT("Outdate")) return Outdate();
	if (Stage == TEXT("Unsynced")) return Unsynced();
	if (Stage == TEXT("AfterGather")) return AfterGather();
	UE_LOG(LogTemp, Error, TEXT("Unknown Game Text problems stage: %s"), *Stage);
	return false;
}
