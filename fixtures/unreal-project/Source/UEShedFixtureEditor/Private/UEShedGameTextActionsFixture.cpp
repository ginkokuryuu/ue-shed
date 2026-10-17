#include "UEShedGameTextActionsFixture.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetToolsModule.h"
#include "Blueprint/UserWidget.h"
#include "Blueprint/WidgetBlueprintGeneratedClass.h"
#include "Blueprint/WidgetTree.h"
#include "Components/TextBlock.h"
#include "Components/TextRenderComponent.h"
#include "Components/VerticalBox.h"
#include "DataTableEditorUtils.h"
#include "Dom/JsonObject.h"
#include "EdGraphSchema_K2.h"
#include "EdGraphUtilities.h"
#include "Engine/TextRenderActor.h"
#include "Engine/World.h"
#include "Factories/WorldFactory.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/DataTable.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "GameFramework/Actor.h"
#include "HAL/FileManager.h"
#include "IAssetTools.h"
#include "Internationalization/GatherableTextData.h"
#include "Internationalization/StringTable.h"
#include "Internationalization/StringTableCore.h"
#include "Internationalization/TextPackageNamespaceUtil.h"
#include "K2Node_CallFunction.h"
#include "K2Node_Event.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "LocalizationConfigurationScript.h"
#include "LocalizationSettings.h"
#include "Misc/EngineVersion.h"
#include "Misc/EngineVersionComparison.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/PropertyLocalizationDataGathering.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "UEShedFixtureTypes.h"
#include "WidgetBlueprint.h"

// Each case is listed in the fixture README ("Game Text identity cases") and asserted through
// FixtureSource/GameTextActions/expected-cases.json. Every stage runs in a fresh process.
//
// Text is typed as a user types it, never given a hand-picked key: TypedText asks Unreal for the id
// the details panel or a graph pin would assign. Copies are made through the editor's own copy
// paths (row duplicate, node paste, Content Browser duplicate), and a branch is a plain file copy,
// as a Perforce branch or integrate makes. The evidence then records what Unreal did to each id.
namespace
{
const TCHAR* TargetName = TEXT("GameTextActions");
const TCHAR* Root = TEXT("/Game/Fixture/GameTextActions");
const TCHAR* BranchFolder = TEXT("Branched");
const TArray<FString> ForeignCultures = { TEXT("de") };
const TArray<FString> BranchedAssets = { TEXT("DT_ActionRows"), TEXT("DA_ActionNotes"), TEXT("BP_ActionSign"), TEXT("WBP_ActionPanel") };
// AActor::ReceiveBeginPlay is protected, so GET_FUNCTION_NAME_CHECKED cannot name it.
const FName BeginPlayName(TEXT("ReceiveBeginPlay"));

FString ObjectPath(const FString& Name)
{
	const FString Asset = FPaths::GetBaseFilename(Name);
	return FString(Root) / Name + TEXT(".") + Asset;
}

FString PackageFile(const FString& Name)
{
	return FPackageName::LongPackageNameToFilename(FString(Root) / Name, FPackageName::GetAssetPackageExtension());
}

bool Save(UObject* Asset)
{
	// GetPackage, not GetOutermost: a World Partition actor saves to its own external package.
	UPackage* Package = Asset->GetPackage();
	Package->MarkPackageDirty();
	const FString Filename = FPackageName::LongPackageNameToFilename(Package->GetName(),
		Asset->IsA<UWorld>() ? FPackageName::GetMapPackageExtension() : FPackageName::GetAssetPackageExtension());
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

template <typename T> T* Load(const FString& Name)
{
	return LoadObject<T>(nullptr, *ObjectPath(Name));
}

/**
 * The text a user gets by typing Source over Current, as STextPropertyEditableTextBox::SetText and
 * SGraphPinText do: Unreal keeps the current id only when no other text in the package uses it.
 */
FText TypedText(UPackage* Package, const FText& Current, const FString& Source)
{
	const FString* CurrentSource = FTextInspector::GetSourceString(Current);
	FString Namespace;
	FString Key;
	TextNamespaceUtil::GetTextIdForEdit(Package, TextNamespaceUtil::ETextEditAction::SourceString,
		CurrentSource ? *CurrentSource : FString(), FTextInspector::GetNamespace(Current).Get(FString()),
		FTextInspector::GetKey(Current).Get(FString()), Namespace, Key);
	return FText::ChangeKey(FTextKey(Namespace), FTextKey(Key), FText::FromString(Source));
}

FUEShedFixtureTextRow* FindRow(UDataTable* Rows, const TCHAR* Name)
{
	return Rows ? Rows->FindRow<FUEShedFixtureTextRow>(Name, TEXT("Fixture")) : nullptr;
}

bool TypeRow(UDataTable* Rows, const TCHAR* Name, const FString& Source)
{
	FUEShedFixtureTextRow* Row = FindRow(Rows, Name);
	if (!Row) return false;
	Row->DisplayName = TypedText(Rows->GetOutermost(), Row->DisplayName, Source);
	return true;
}

UTextBlock* Heading(UWidgetBlueprint* Panel)
{
	return Panel && Panel->WidgetTree ? Cast<UTextBlock>(Panel->WidgetTree->FindWidget(TEXT("Heading"))) : nullptr;
}

bool TypeHeading(UWidgetBlueprint* Panel, const FString& Source)
{
	UTextBlock* Block = Heading(Panel);
	if (!Block) return false;
	Block->SetText(TypedText(Panel->GetOutermost(), Block->GetText(), Source));
	FKismetEditorUtilities::CompileBlueprint(Panel);
	return true;
}

UEdGraphPin* TextPin(UK2Node_CallFunction* Node)
{
	return Node ? Node->FindPin(TEXT("InText")) : nullptr;
}

bool TypePin(UEdGraphPin* Pin, const FString& Source)
{
	if (!Pin) return false;
	GetDefault<UEdGraphSchema_K2>()->TrySetDefaultText(*Pin,
		TypedText(Pin->GetOwningNode()->GetOutermost(), Pin->DefaultTextValue, Source));
	return true;
}

/** Print Text nodes of the event graph, in execution order from BeginPlay. */
TArray<UK2Node_CallFunction*> PrintNodes(UBlueprint* Blueprint)
{
	TArray<UK2Node_CallFunction*> Result;
	UK2Node_Event* BeginPlay = FBlueprintEditorUtils::FindOverrideForFunction(
		Blueprint, AActor::StaticClass(), BeginPlayName);
	UEdGraphPin* Then = BeginPlay ? BeginPlay->FindPin(UEdGraphSchema_K2::PN_Then) : nullptr;
	while (Then && Then->LinkedTo.Num() == 1)
	{
		UK2Node_CallFunction* Node = Cast<UK2Node_CallFunction>(Then->LinkedTo[0]->GetOwningNode());
		if (!Node) break;
		Result.Add(Node);
		Then = Node->GetThenPin();
	}
	return Result;
}

bool Link(UEdGraphPin* Then, UK2Node_CallFunction* Node)
{
	return Then && Node && GetDefault<UEdGraphSchema_K2>()->TryCreateConnection(Then, Node->GetExecPin());
}

bool Rows()
{
	UDataTable* Rows = CreateAsset<UDataTable>(ObjectPath(TEXT("DT_ActionRows")));
	Rows->RowStruct = FUEShedFixtureTextRow::StaticStruct();
	Rows->EmptyTable();
	FDataTableEditorUtils::AddRow(Rows, TEXT("Lantern"));
	FDataTableEditorUtils::AddRow(Rows, TEXT("Rope"));
	return TypeRow(Rows, TEXT("Lantern"), TEXT("Brass lantern"))
		&& TypeRow(Rows, TEXT("Rope"), TEXT("Coil of rope"))
		&& Save(Rows);
}

bool Notes()
{
	UUEShedFixtureTextAsset* Notes = CreateAsset<UUEShedFixtureTextAsset>(ObjectPath(TEXT("DA_ActionNotes")));
	Notes->SharedPrimary = TypedText(Notes->GetOutermost(), Notes->SharedPrimary, TEXT("Keep the lamp lit"));
	return Save(Notes);
}

/**
 * An actor Blueprint holding text three ways: a variable default on the class defaults, a Print
 * Text literal compiled into BeginPlay's bytecode, and a TextRender component template.
 */
bool Sign()
{
	const FString Path = ObjectPath(TEXT("BP_ActionSign"));
	UPackage* Package = CreatePackage(*FPackageName::ObjectPathToPackageName(Path));
	UBlueprint* Sign = FKismetEditorUtilities::CreateBlueprint(AActor::StaticClass(), Package,
		*FPackageName::ObjectPathToObjectName(Path), BPTYPE_Normal, UBlueprint::StaticClass(),
		UBlueprintGeneratedClass::StaticClass());
	if (!Sign) return false;
	FAssetRegistryModule::AssetCreated(Sign);

	USCS_Node* Node = Sign->SimpleConstructionScript->CreateNode(UTextRenderComponent::StaticClass(), TEXT("Plate"));
	Sign->SimpleConstructionScript->AddNode(Node);
	UTextRenderComponent* Plate = CastChecked<UTextRenderComponent>(Node->ComponentTemplate);
	Plate->SetText(TypedText(Package, Plate->Text, TEXT("Harbor Road")));

	FEdGraphPinType TextType;
	TextType.PinCategory = UEdGraphSchema_K2::PC_Text;
	if (!FBlueprintEditorUtils::AddMemberVariable(Sign, TEXT("Greeting"), TextType)) return false;

	// New actor Blueprints start with a ghost BeginPlay; wiring a node to it enables it.
	UK2Node_Event* BeginPlay = FBlueprintEditorUtils::FindOverrideForFunction(
		Sign, AActor::StaticClass(), BeginPlayName);
	UEdGraph* Graph = BeginPlay ? BeginPlay->GetGraph() : nullptr;
	if (!Graph) return false;
	BeginPlay->SetEnabledState(ENodeEnabledState::Enabled, false);
	UK2Node_CallFunction* Print = NewObject<UK2Node_CallFunction>(Graph);
	Print->SetFromFunction(UKismetSystemLibrary::StaticClass()->FindFunctionByName(
		GET_FUNCTION_NAME_CHECKED(UKismetSystemLibrary, PrintText)));
	Print->NodePosX = BeginPlay->NodePosX + 320;
	Print->NodePosY = BeginPlay->NodePosY;
	Graph->AddNode(Print, true, false);
	Print->CreateNewGuid();
	Print->PostPlacedNewNode();
	Print->AllocateDefaultPins();
	if (!TypePin(TextPin(Print), TEXT("The door is locked"))
		|| !Link(BeginPlay->FindPin(UEdGraphSchema_K2::PN_Then), Print)) return false;
	FKismetEditorUtilities::CompileBlueprint(Sign);

	// The class defaults hold the variable's value, as editing it in Class Defaults does.
	UObject* Defaults = Sign->GeneratedClass->GetDefaultObject();
	FTextProperty* Greeting = CastField<FTextProperty>(Sign->GeneratedClass->FindPropertyByName(TEXT("Greeting")));
	if (!Greeting) return false;
	FText* Value = Greeting->ContainerPtrToValuePtr<FText>(Defaults);
	*Value = TypedText(Package, *Value, TEXT("Welcome, traveler"));
	FBlueprintEditorUtils::MarkBlueprintAsModified(Sign);
	FKismetEditorUtilities::CompileBlueprint(Sign);
	return Save(Sign);
}

/** A compiled Widget Blueprint with one designer text block under a vertical box. */
bool Panel()
{
	const FString Path = ObjectPath(TEXT("WBP_ActionPanel"));
	UPackage* Package = CreatePackage(*FPackageName::ObjectPathToPackageName(Path));
	UWidgetBlueprint* Panel = Cast<UWidgetBlueprint>(FKismetEditorUtilities::CreateBlueprint(
		UUserWidget::StaticClass(), Package, *FPackageName::ObjectPathToObjectName(Path), BPTYPE_Normal,
		UWidgetBlueprint::StaticClass(), UWidgetBlueprintGeneratedClass::StaticClass()));
	if (!Panel || !Panel->WidgetTree) return false;
	FAssetRegistryModule::AssetCreated(Panel);
	UVerticalBox* Box = Panel->WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("Root"));
	Panel->WidgetTree->RootWidget = Box;
	Box->AddChild(Panel->WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("Heading")));
	return TypeHeading(Panel, TEXT("Harbor master")) && Save(Panel);
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
	Settings.Guid = FGuid(0x6A1C4D2E, 0x4B7F9A03, 0x8E215C64, 0xD3F0B71A);
	Settings.NativeCultureIndex = 0;
	Settings.SupportedCulturesStatistics.Add(FCultureStatistics(TEXT("en")));
	for (const FString& Culture : ForeignCultures) Settings.SupportedCulturesStatistics.Add(FCultureStatistics(Culture));
	Settings.GatherFromTextFiles.IsEnabled = false;
	Settings.GatherFromPackages.IsEnabled = true;
	FGatherTextIncludePath Content;
	Content.Pattern = TEXT("Content/Fixture/GameTextActions/*");
	Settings.GatherFromPackages.IncludePathWildcards.Add(Content);
	Settings.GatherFromPackages.ShouldGatherFromEditorOnlyData = false;
	// A studio's default: Unreal takes text from saved gather tables where it can.
	Settings.GatherFromPackages.SkipGatherCache = false;
	Target->Settings = Settings;
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

/** Copies inside one package: a duplicated row and pasted graph nodes, one of each then retyped. */
bool CopyInPackage()
{
	UDataTable* Rows = Load<UDataTable>(TEXT("DT_ActionRows"));
	if (!Rows || !FDataTableEditorUtils::DuplicateRow(Rows, TEXT("Lantern"), TEXT("Lantern_Copy"))
		|| !FDataTableEditorUtils::DuplicateRow(Rows, TEXT("Rope"), TEXT("Rope_Copy"))
		|| !TypeRow(Rows, TEXT("Rope_Copy"), TEXT("Coil of old rope")) || !Save(Rows)) return false;

	// Ctrl+C, Ctrl+V twice: FBlueprintEditor::PasteNodesHere imports the nodes and gives each a new
	// GUID. Both copies are wired after the original, and the second one is retyped.
	UBlueprint* Sign = Load<UBlueprint>(TEXT("BP_ActionSign"));
	TArray<UK2Node_CallFunction*> Prints = Sign ? PrintNodes(Sign) : TArray<UK2Node_CallFunction*>();
	if (Prints.Num() != 1) return false;
	FString Clipboard;
	FEdGraphUtilities::ExportNodesToText(TSet<UObject*>{ Prints[0] }, Clipboard);
	UEdGraph* Graph = Prints[0]->GetGraph();
	UK2Node_CallFunction* Previous = Prints[0];
	for (int32 Copy = 1; Copy <= 2; ++Copy)
	{
		TSet<UEdGraphNode*> Pasted;
		FEdGraphUtilities::ImportNodesFromText(Graph, Clipboard, Pasted);
		UK2Node_CallFunction* Node = Pasted.Num() == 1 ? Cast<UK2Node_CallFunction>(*Pasted.CreateIterator()) : nullptr;
		if (!Node) return false;
		Node->CreateNewGuid();
		Node->NodePosX = Previous->NodePosX + 320;
		Node->NodePosY = Previous->NodePosY;
		if (!Link(Previous->GetThenPin(), Node)) return false;
		Previous = Node;
	}
	if (!TypePin(TextPin(Previous), TEXT("The door is barred"))) return false;
	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Sign);
	FKismetEditorUtilities::CompileBlueprint(Sign);
	return Save(Sign);
}

/** Content Browser Duplicate of each asset; only the widget's copy is retyped. */
bool DuplicateAssets()
{
	IAssetTools& Tools = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools")).Get();
	for (const FString& Name : BranchedAssets)
	{
		UObject* Source = Load<UObject>(Name);
		UObject* Copy = Source ? Tools.DuplicateAsset(Name + TEXT("_Duplicate"), Root, Source) : nullptr;
		if (!Copy) return false;
		if (UWidgetBlueprint* Panel = Cast<UWidgetBlueprint>(Copy))
		{
			if (!TypeHeading(Panel, TEXT("Harbor mistress"))) return false;
		}
		if (!Save(Copy)) return false;
	}
	return true;
}

/** A file-level copy, as a Perforce branch or integrate makes; nothing is loaded. */
bool Branch()
{
	for (const FString& Name : BranchedAssets)
	{
		const FString Destination = PackageFile(FString(BranchFolder) / Name);
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(Destination), true);
		if (IFileManager::Get().Copy(*Destination, *PackageFile(Name), true) != COPY_OK) return false;
	}
	return true;
}

/** The branch's copies are then edited on their own, as work on another branch is. */
bool EditBranch()
{
	const FString Folder = FString(BranchFolder) + TEXT("/");
	UDataTable* Rows = Load<UDataTable>(Folder + TEXT("DT_ActionRows"));
	UUEShedFixtureTextAsset* Notes = Load<UUEShedFixtureTextAsset>(Folder + TEXT("DA_ActionNotes"));
	UWidgetBlueprint* Panel = Load<UWidgetBlueprint>(Folder + TEXT("WBP_ActionPanel"));
	if (!Rows || !Notes || !Panel) return false;
	Notes->SharedPrimary = TypedText(Notes->GetOutermost(), Notes->SharedPrimary, TEXT("Keep the lamp lit at night"));
	return TypeRow(Rows, TEXT("Lantern"), TEXT("Brass ship lantern"))
		&& TypeHeading(Panel, TEXT("Harbor master's office"))
		&& Save(Rows) && Save(Notes) && Save(Panel);
}

// Slice 2 (Plan 058 A4): text in places slice 1 does not cover, under Slice2/.
const TCHAR* Slice2 = TEXT("Slice2/");

/** A String Table, and a data asset holding typed text and a reference to one of its entries. */
bool StringTables()
{
	UStringTable* Table = CreateAsset<UStringTable>(ObjectPath(FString(Slice2) + TEXT("ST_IdentityTable")));
	FStringTableRef Mutable = Table->GetMutableStringTable();
	Mutable->SetNamespace(FTextKey(TEXT("IdentityTable")));
#if UE_VERSION_OLDER_THAN(5, 8, 0)
	Mutable->SetSourceString(FTextKey(TEXT("Welcome")), TEXT("Welcome aboard"));
	Mutable->SetSourceString(FTextKey(TEXT("Farewell")), TEXT("Fair winds"));
#else
	Mutable->SetSourceString(FTextKey(TEXT("Welcome")), TEXT("Welcome aboard"), FString());
	Mutable->SetSourceString(FTextKey(TEXT("Farewell")), TEXT("Fair winds"), FString());
#endif
	if (!Save(Table)) return false;
	UUEShedFixtureTextAsset* Notes = CreateAsset<UUEShedFixtureTextAsset>(ObjectPath(FString(Slice2) + TEXT("DA_IdentityReferences")));
	Notes->StringTableReference = FText::FromStringTable(Table->GetStringTableId(), TEXT("Welcome"));
	Notes->SharedPrimary = TypedText(Notes->GetOutermost(), Notes->SharedPrimary, TEXT("Welcome aboard"));
	Notes->SharedSecondary = FText::AsCultureInvariant(TEXT("Deck 3"));
	return Save(Notes);
}

UBlueprint* CreateActorBlueprint(const FString& Name, UClass* Parent)
{
	const FString Path = ObjectPath(Name);
	UPackage* Package = CreatePackage(*FPackageName::ObjectPathToPackageName(Path));
	UBlueprint* Blueprint = FKismetEditorUtilities::CreateBlueprint(Parent, Package,
		*FPackageName::ObjectPathToObjectName(Path), BPTYPE_Normal, UBlueprint::StaticClass(),
		UBlueprintGeneratedClass::StaticClass());
	if (Blueprint) FAssetRegistryModule::AssetCreated(Blueprint);
	return Blueprint;
}

/** Print Text nodes wired after BeginPlay, one per pin text, in order. */
bool PrintTexts(UBlueprint* Blueprint, const TArray<FText>& Texts)
{
	UK2Node_Event* BeginPlay = FBlueprintEditorUtils::FindOverrideForFunction(
		Blueprint, AActor::StaticClass(), BeginPlayName);
	UEdGraph* Graph = BeginPlay ? BeginPlay->GetGraph() : nullptr;
	if (!Graph) return false;
	BeginPlay->SetEnabledState(ENodeEnabledState::Enabled, false);
	UEdGraphPin* Then = BeginPlay->FindPin(UEdGraphSchema_K2::PN_Then);
	int32 X = BeginPlay->NodePosX;
	for (const FText& Text : Texts)
	{
		UK2Node_CallFunction* Print = NewObject<UK2Node_CallFunction>(Graph);
		Print->SetFromFunction(UKismetSystemLibrary::StaticClass()->FindFunctionByName(
			GET_FUNCTION_NAME_CHECKED(UKismetSystemLibrary, PrintText)));
		X += 320;
		Print->NodePosX = X;
		Print->NodePosY = BeginPlay->NodePosY;
		Graph->AddNode(Print, true, false);
		Print->CreateNewGuid();
		Print->PostPlacedNewNode();
		Print->AllocateDefaultPins();
		UEdGraphPin* Pin = TextPin(Print);
		if (!Pin || !Link(Then, Print)) return false;
		GetDefault<UEdGraphSchema_K2>()->TrySetDefaultText(*Pin, Text);
		Then = Print->GetThenPin();
	}
	return true;
}

/**
 * Compiled literals of each saved kind: typed (localized) text, culture-invariant text and a
 * String Table reference, each a Print Text pin compiled into BeginPlay's bytecode.
 */
bool Literals()
{
	UBlueprint* Literals = CreateActorBlueprint(FString(Slice2) + TEXT("BP_IdentityLiterals"), AActor::StaticClass());
	const UStringTable* Table = LoadObject<UStringTable>(nullptr, *ObjectPath(FString(Slice2) + TEXT("ST_IdentityTable")));
	if (!Literals || !Table) return false;
	UPackage* Package = Literals->GetOutermost();
	if (!PrintTexts(Literals, { TypedText(Package, FText::GetEmpty(), TEXT("Lamp lit")),
		FText::AsCultureInvariant(TEXT("v1.0")), FText::FromStringTable(Table->GetStringTableId(), TEXT("Farewell")) }))
		return false;
	FKismetEditorUtilities::CompileBlueprint(Literals);
	return Save(Literals);
}

FText* DefaultText(UBlueprint* Blueprint, const TCHAR* Property)
{
	FTextProperty* Text = CastField<FTextProperty>(Blueprint->GeneratedClass->FindPropertyByName(Property));
	return Text ? Text->ContainerPtrToValuePtr<FText>(Blueprint->GeneratedClass->GetDefaultObject()) : nullptr;
}

/** A parent Blueprint's variable default, a child that inherits it and a child that overrides it. */
bool Inheritance()
{
	UBlueprint* Parent = CreateActorBlueprint(FString(Slice2) + TEXT("BP_IdentityParent"), AActor::StaticClass());
	if (!Parent) return false;
	FEdGraphPinType TextType;
	TextType.PinCategory = UEdGraphSchema_K2::PC_Text;
	if (!FBlueprintEditorUtils::AddMemberVariable(Parent, TEXT("Motto"), TextType)) return false;
	FKismetEditorUtilities::CompileBlueprint(Parent);
	FText* Motto = DefaultText(Parent, TEXT("Motto"));
	if (!Motto) return false;
	*Motto = TypedText(Parent->GetOutermost(), *Motto, TEXT("Steady as she goes"));
	FBlueprintEditorUtils::MarkBlueprintAsModified(Parent);
	FKismetEditorUtilities::CompileBlueprint(Parent);
	if (!Save(Parent)) return false;

	UBlueprint* Inherits = CreateActorBlueprint(FString(Slice2) + TEXT("BP_IdentityChildInherits"), Parent->GeneratedClass);
	UBlueprint* Overrides = CreateActorBlueprint(FString(Slice2) + TEXT("BP_IdentityChildOverrides"), Parent->GeneratedClass);
	if (!Inherits || !Overrides) return false;
	FKismetEditorUtilities::CompileBlueprint(Inherits);
	FKismetEditorUtilities::CompileBlueprint(Overrides);
	FText* Override = DefaultText(Overrides, TEXT("Motto"));
	if (!Override) return false;
	// Typed over the inherited value in the child's Class Defaults.
	*Override = TypedText(Overrides->GetOutermost(), *Override, TEXT("Full speed ahead"));
	FBlueprintEditorUtils::MarkBlueprintAsModified(Overrides);
	FKismetEditorUtilities::CompileBlueprint(Overrides);
	return Save(Inherits) && Save(Overrides);
}

ATextRenderActor* PlaceSign(UWorld* World, const FString& Source, const bool bExternal)
{
	FActorSpawnParameters Spawn;
	Spawn.bCreateActorPackage = bExternal;
	ATextRenderActor* Sign = World->SpawnActor<ATextRenderActor>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn);
	if (!Sign) return nullptr;
	UTextRenderComponent* Render = Sign->GetTextRender();
	// The actor's own package: the level's, or its external package in a World Partition map.
	Render->SetText(TypedText(Sign->GetPackage(), Render->Text, Source));
	return Sign;
}

UWorld* CreateMap(const FString& Name, const bool bWorldPartition)
{
	const FString Path = ObjectPath(Name);
	UPackage* Package = CreatePackage(*FPackageName::ObjectPathToPackageName(Path));
	UWorldFactory* Factory = NewObject<UWorldFactory>();
	Factory->WorldType = EWorldType::Editor;
	Factory->bCreateWorldPartition = bWorldPartition;
	Factory->bEnableWorldPartitionStreaming = false;
	UWorld* World = Cast<UWorld>(Factory->FactoryCreateNew(UWorld::StaticClass(), Package,
		*FPackageName::ObjectPathToObjectName(Path), RF_Public | RF_Standalone, nullptr, GWarn));
	if (World) FAssetRegistryModule::AssetCreated(World);
	return World;
}

/** A TextRender actor in a level, and one saved as a World Partition external actor. */
bool Levels()
{
	UWorld* Level = CreateMap(FString(Slice2) + TEXT("L_IdentityLevel"), false);
	if (!Level) return false;
	ATextRenderActor* LevelSign = PlaceSign(Level, TEXT("Harbor gate"), false);
	const bool bLevelSaved = LevelSign && Save(Level);
	Level->CleanupWorld();
	if (!bLevelSaved) return false;
	UWorld* Partitioned = CreateMap(FString(Slice2) + TEXT("L_IdentityWorld"), true);
	if (!Partitioned) return false;
	ATextRenderActor* ExternalSign = Partitioned->IsPartitionedWorld() ? PlaceSign(Partitioned, TEXT("Lighthouse"), true) : nullptr;
	const bool bWorldSaved = ExternalSign && ExternalSign->GetExternalPackage() && Save(Partitioned) && Save(ExternalSign);
	// An initialized World Partition must be torn down before the commandlet exits.
	Partitioned->CleanupWorld();
	return bWorldSaved;
}

/**
 * Unreal's own gather table for every package, from FPropertyLocalizationDataGatherer: the text a
 * gather takes from each saved package, with each package's localization namespace.
 */
bool Evidence(const FString& Output)
{
	TArray<FString> Files;
	const FString Directory = FPaths::ProjectContentDir() / TEXT("Fixture/GameTextActions");
	IFileManager::Get().FindFilesRecursive(Files, *Directory, TEXT("*.uasset"), true, false);
	IFileManager::Get().FindFilesRecursive(Files, *Directory, TEXT("*.umap"), true, false, false);
	// World Partition external actors are saved beside the content root, one package per actor.
	IFileManager::Get().FindFilesRecursive(Files,
		*(FPaths::ProjectContentDir() / TEXT("__ExternalActors__/Fixture/GameTextActions")), TEXT("*.uasset"), true, false, false);
	Files.Sort();
	TArray<TSharedPtr<FJsonValue>> Packages;
	for (const FString& File : Files)
	{
		FString PackageName;
		if (!FPackageName::TryConvertFilenameToLongPackageName(File, PackageName)) return false;
		UPackage* Package = LoadPackage(nullptr, *PackageName, LOAD_None);
		if (!Package) return false;
		TArray<FGatherableTextData> Gathered;
		EPropertyLocalizationGathererResultFlags Flags = EPropertyLocalizationGathererResultFlags::Empty;
		FPropertyLocalizationDataGatherer(Gathered, Package, Flags);
		TArray<TSharedPtr<FJsonValue>> Texts;
		for (const FGatherableTextData& Data : Gathered)
		{
			for (const FTextSourceSiteContext& Site : Data.SourceSiteContexts)
			{
				const TSharedRef<FJsonObject> Text = MakeShared<FJsonObject>();
				Text->SetStringField(TEXT("site"), Site.SiteDescription);
				Text->SetStringField(TEXT("namespace"), Data.NamespaceName);
				Text->SetStringField(TEXT("key"), Site.KeyName);
				Text->SetStringField(TEXT("source"), Data.SourceData.SourceString);
				Text->SetBoolField(TEXT("editorOnly"), Site.IsEditorOnly);
				Texts.Add(MakeShared<FJsonValueObject>(Text));
			}
		}
		Texts.Sort([](const TSharedPtr<FJsonValue>& Left, const TSharedPtr<FJsonValue>& Right)
		{
			const FString LeftSite = Left->AsObject()->GetStringField(TEXT("site"));
			const FString RightSite = Right->AsObject()->GetStringField(TEXT("site"));
			return LeftSite == RightSite
				? Left->AsObject()->GetStringField(TEXT("key")) < Right->AsObject()->GetStringField(TEXT("key"))
				: LeftSite < RightSite;
		});
		const TSharedRef<FJsonObject> Entry = MakeShared<FJsonObject>();
		Entry->SetStringField(TEXT("package"), PackageName);
		Entry->SetStringField(TEXT("packageNamespace"), TextNamespaceUtil::GetPackageNamespace(Package));
		Entry->SetArrayField(TEXT("texts"), Texts);
		Packages.Add(MakeShared<FJsonValueObject>(Entry));
	}
	const TSharedRef<FJsonObject> Evidence = MakeShared<FJsonObject>();
	Evidence->SetNumberField(TEXT("schemaVersion"), 1);
	Evidence->SetStringField(TEXT("target"), TargetName);
	Evidence->SetStringField(TEXT("engineVersion"), FString::Printf(TEXT("%d.%d"),
		FEngineVersion::Current().GetMajor(), FEngineVersion::Current().GetMinor()));
	Evidence->SetArrayField(TEXT("packages"), Packages);
	FString Contents;
	if (!FJsonSerializer::Serialize(Evidence, TJsonWriterFactory<>::Create(&Contents))) return false;
	IFileManager::Get().MakeDirectory(*Output, true);
	return FFileHelper::SaveStringToFile(Contents, *(Output / FString::Printf(TEXT("evidence.ue%d.%d.json"),
		FEngineVersion::Current().GetMajor(), FEngineVersion::Current().GetMinor())),
		FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}
}

bool RunGameTextActionsFixture(const FString& Params)
{
	FString Stage;
	if (!FParse::Value(*Params, TEXT("GameTextActionsStage="), Stage)) return false;
	if (Stage == TEXT("Author")) return Rows() && Notes() && Sign() && Panel() && GenerateConfigs();
	if (Stage == TEXT("CopyInPackage")) return CopyInPackage();
	if (Stage == TEXT("DuplicateAssets")) return DuplicateAssets();
	if (Stage == TEXT("Branch")) return Branch();
	if (Stage == TEXT("EditBranch")) return EditBranch();
	if (Stage == TEXT("Slice2")) return StringTables() && Literals() && Inheritance() && Levels();
	if (Stage == TEXT("Evidence"))
	{
		FString Output;
		if (!FParse::Value(*Params, TEXT("GameTextActionsEvidence="), Output))
		{
			UE_LOG(LogTemp, Error, TEXT("Evidence requires -GameTextActionsEvidence=<directory>."));
			return false;
		}
		return Evidence(Output);
	}
	UE_LOG(LogTemp, Error, TEXT("Unknown Game Text actions stage: %s"), *Stage);
	return false;
}
