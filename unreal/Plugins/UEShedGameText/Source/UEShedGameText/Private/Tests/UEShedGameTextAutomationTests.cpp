#include "UEShedGameTextActions.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "Tests/UEShedGameTextTestTypes.h"
#include "Components/TextRenderComponent.h"
#include "BlueprintEditorSettings.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Misc/ScopeExit.h"
#include "UObject/SavePackage.h"
#include "Dom/JsonObject.h"
#include "EdGraphSchema_K2.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/DataTable.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "GameFramework/Actor.h"
#include "Internationalization/TextNamespaceUtil.h"
#include "Internationalization/TextPackageNamespaceUtil.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/AutomationTest.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/Package.h"
#include "UObject/TextProperty.h"

namespace
{
struct FId
{
	FString Namespace;
	FString Key;
	FString Source;
};

FId IdOf(const FText& Text)
{
	const FTextId Id = FTextInspector::GetTextId(Text);
	const FString* Source = FTextInspector::GetSourceString(Text);
	return { TextNamespaceUtil::StripPackageNamespace(Id.GetNamespace().ToString()), Id.GetKey().ToString(),
		Source ? *Source : FString() };
}

/** Types Source into Value as the details panel does, so the text gets an editor-assigned key. */
void Type(UPackage* Package, FText& Value, const FString& Source)
{
	const FTextProperty* Property = CastFieldChecked<FTextProperty>(
		UUEShedGameTextTestObject::StaticClass()->FindPropertyByName(TEXT("Title")));
	TextNamespaceUtil::EditTextProperty_Direct(Package, &Value, Property, TextNamespaceUtil::ETextEditAction::SourceString, Source);
}

UPackage* TestPackage(const TCHAR* Name)
{
	return CreatePackage(*FString::Printf(TEXT("/Game/UEShedGameTextTest/%s_%s"), Name,
		*FGuid::NewGuid().ToString(EGuidFormats::Digits)));
}

FString PackageFile(UPackage* Package)
{
	return FPaths::ConvertRelativePathToFull(FPackageName::LongPackageNameToFilename(Package->GetName(), FPackageName::GetAssetPackageExtension()));
}

bool SaveTestPackage(UPackage* Package)
{
	FSavePackageArgs Args;
	Args.TopLevelFlags = RF_Public | RF_Standalone;
	Args.SaveFlags = SAVE_NoError;
	return UPackage::SavePackage(Package, Package->FindAssetInPackage(), *PackageFile(Package), Args);
}

TArray<uint8> PackageBytes(UPackage* Package)
{
	TArray<uint8> Bytes;
	FFileHelper::LoadFileToArray(Bytes, *PackageFile(Package));
	return Bytes;
}

TSharedRef<FJsonObject> Action(const FString& Id, const FString& ObjectPath, const FString& PropertyPath, const FId& Expected,
	const TSharedRef<FJsonObject>& Edit)
{
	const TSharedRef<FJsonObject> Place = MakeShared<FJsonObject>();
	Place->SetStringField(TEXT("objectPath"), ObjectPath);
	Place->SetStringField(TEXT("packageFile"), FPaths::ConvertRelativePathToFull(FPackageName::LongPackageNameToFilename(
		FPackageName::ObjectPathToPackageName(ObjectPath), FPackageName::GetAssetPackageExtension())));
	Place->SetStringField(TEXT("propertyPath"), PropertyPath);
	const TSharedRef<FJsonObject> ExpectedJson = MakeShared<FJsonObject>();
	ExpectedJson->SetStringField(TEXT("namespace"), Expected.Namespace);
	ExpectedJson->SetStringField(TEXT("key"), Expected.Key);
	ExpectedJson->SetStringField(TEXT("source"), Expected.Source);
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("id"), Id);
	Json->SetObjectField(TEXT("place"), Place);
	Json->SetObjectField(TEXT("expected"), ExpectedJson);
	Json->SetObjectField(TEXT("edit"), Edit);
	return Json;
}

TSharedRef<FJsonObject> EditJson(const TCHAR* Kind, const FString& Namespace = FString(), const FString& Key = FString(),
	const FString& Source = FString())
{
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("kind"), Kind);
	if (!Key.IsEmpty())
	{
		Json->SetStringField(TEXT("namespace"), Namespace);
		Json->SetStringField(TEXT("key"), Key);
	}
	if (!Source.IsEmpty()) Json->SetStringField(TEXT("source"), Source);
	return Json;
}

TSharedPtr<FJsonObject> Run(const TCHAR* Mode, const TArray<TSharedRef<FJsonObject>>& Actions, const bool bCompile = true,
	const bool bSave = false)
{
	const TSharedRef<FJsonObject> Request = MakeShared<FJsonObject>();
	Request->SetStringField(TEXT("contract"), TEXT("ue-shed-game-text-actions"));
	Request->SetStringField(TEXT("version"), TEXT("1.0"));
	Request->SetStringField(TEXT("mode"), Mode);
	Request->SetBoolField(TEXT("compile"), bCompile);
	Request->SetBoolField(TEXT("save"), bSave);
	TArray<TSharedPtr<FJsonValue>> Items;
	for (const TSharedRef<FJsonObject>& Item : Actions) Items.Add(MakeShared<FJsonValueObject>(Item));
	Request->SetArrayField(TEXT("actions"), Items);
	FString RequestJson;
	FJsonSerializer::Serialize(Request, TJsonWriterFactory<>::Create(&RequestJson));
	TSharedPtr<FJsonObject> Result;
	FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(UEShedGameText::ApplyTextActions(RequestJson)), Result);
	return Result;
}

FString FirstErrorCode(const TSharedPtr<FJsonObject>& Result)
{
	const TArray<TSharedPtr<FJsonValue>>* Errors = nullptr;
	if (!Result.IsValid() || !Result->TryGetArrayField(TEXT("errors"), Errors) || Errors->IsEmpty()) return FString();
	return (*Errors)[0]->AsObject()->GetStringField(TEXT("code"));
}

FString RunRaw(const FString& RequestJson)
{
	TSharedPtr<FJsonObject> Result;
	FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(UEShedGameText::ApplyTextActions(RequestJson)), Result);
	return Result.IsValid() ? Result->GetStringField(TEXT("status")) + TEXT(":") + FirstErrorCode(Result) : TEXT("no JSON");
}

FString Status(const TSharedPtr<FJsonObject>& Result)
{
	return Result.IsValid() ? Result->GetStringField(TEXT("status")) : TEXT("no JSON");
}

bool Same(const FId& Left, const FId& Right)
{
	return Left.Namespace == Right.Namespace && Left.Key == Right.Key && Left.Source == Right.Source;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUEShedGameTextObjectPropertiesTest, "UEShed.GameText.ObjectProperties",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FUEShedGameTextObjectPropertiesTest::RunTest(const FString& Parameters)
{
	UPackage* Package = TestPackage(TEXT("Notes"));
	UUEShedGameTextTestObject* Notes = NewObject<UUEShedGameTextTestObject>(Package, TEXT("Notes"),
		RF_Public | RF_Standalone | RF_Transactional);
	Type(Package, Notes->Title, TEXT("Keep the lamp lit"));
	Notes->Lines.SetNum(3);
	Type(Package, Notes->Lines[0], TEXT("Keep the lamp lit"));
	Type(Package, Notes->Lines[1], TEXT("Mind the gap"));
	Notes->Lines[2] = FText::AsCultureInvariant(TEXT("v1.0"));
	Type(Package, Notes->Info.Caption, TEXT("Harbor"));
	Type(Package, Notes->Labels.Add(TEXT("Door")), TEXT("Locked"));
	Type(Package, Notes->Fixed[1], TEXT("Second"));
	TestTrue(TEXT("Save the baseline object package"), SaveTestPackage(Package));
	ON_SCOPE_EXIT { IFileManager::Get().Delete(*PackageFile(Package)); };
	const FString Path = Notes->GetPathName();
	TestFalse(TEXT("Typed text has a package namespace"), TextNamespaceUtil::GetPackageNamespace(Package).IsEmpty());
	TestEqual(TEXT("The wire namespace leaves the package namespace out"), IdOf(Notes->Title).Namespace, FString());

	// A dry run reports the outcome and changes nothing, dirty flag included.
	Package->SetDirtyFlag(false);
	const FId Title = IdOf(Notes->Title);
	TSharedPtr<FJsonObject> DryRun = Run(TEXT("dry_run"),
		{ Action(TEXT("title"), Path, TEXT("Title"), Title, EditJson(TEXT("change_key"), TEXT("Notes"), TEXT("Lamp"))) });
	TestEqual(TEXT("Dry run status"), Status(DryRun), FString(TEXT("ok")));
	TestTrue(TEXT("Dry run leaves the text"), Same(IdOf(Notes->Title), Title));
	TestFalse(TEXT("Dry run leaves the package clean"), Package->IsDirty());
	const TArray<TSharedPtr<FJsonValue>>* Planned = nullptr;
	if (TestTrue(TEXT("Dry run lists the action"), DryRun.IsValid() && DryRun->TryGetArrayField(TEXT("actions"), Planned)
		&& Planned->Num() == 1))
	{
		const TSharedPtr<FJsonObject> After = (*Planned)[0]->AsObject()->GetObjectField(TEXT("after"));
		TestEqual(TEXT("Planned status"), (*Planned)[0]->AsObject()->GetStringField(TEXT("status")), FString(TEXT("planned")));
		TestEqual(TEXT("Planned namespace"), After->GetStringField(TEXT("namespace")), FString(TEXT("Notes")));
		TestEqual(TEXT("Planned key"), After->GetStringField(TEXT("key")), FString(TEXT("Lamp")));
	}

	// change_key keeps the source and Unreal re-applies the package namespace.
	TSharedPtr<FJsonObject> Changed = Run(TEXT("apply"),
		{ Action(TEXT("title"), Path, TEXT("Title"), Title, EditJson(TEXT("change_key"), TEXT("Notes"), TEXT("Lamp"))) });
	TestEqual(TEXT("change_key status"), Status(Changed), FString(TEXT("ok")));
	TestTrue(TEXT("change_key result"), Same(IdOf(Notes->Title), { TEXT("Notes"), TEXT("Lamp"), TEXT("Keep the lamp lit") }));
	TestEqual(TEXT("Stored namespace keeps the package namespace"),
		TextNamespaceUtil::ExtractPackageNamespace(FTextInspector::GetTextId(Notes->Title).GetNamespace().ToString()),
		TextNamespaceUtil::GetPackageNamespace(Package));
	TestTrue(TEXT("An apply dirties the package"), Package->IsDirty());

	// A reviewed text that changed since is stale, and nothing is edited.
	TSharedPtr<FJsonObject> Stale = Run(TEXT("apply"),
		{ Action(TEXT("title"), Path, TEXT("Title"), Title, EditJson(TEXT("regenerate_key"))) });
	TestEqual(TEXT("Stale status"), Status(Stale), FString(TEXT("rejected")));
	TestEqual(TEXT("Stale code"), FirstErrorCode(Stale), FString(TEXT("stale_expected")));

	// regenerate_key mints a new key and keeps namespace and source.
	const FId Renamed = IdOf(Notes->Title);
	TestEqual(TEXT("regenerate_key status"), Status(Run(TEXT("apply"),
		{ Action(TEXT("title"), Path, TEXT("Title"), Renamed, EditJson(TEXT("regenerate_key"))) })), FString(TEXT("ok")));
	const FId Regenerated = IdOf(Notes->Title);
	TestTrue(TEXT("regenerate_key changes only the key"), Regenerated.Key != Renamed.Key
		&& Regenerated.Namespace == Renamed.Namespace && Regenerated.Source == Renamed.Source);

	// adopt_key merges a second place into the first text's id, through an array element.
	TSharedPtr<FJsonObject> Adopted = Run(TEXT("apply"),
		{ Action(TEXT("line"), Path, TEXT("Lines[0]"), IdOf(Notes->Lines[0]),
			EditJson(TEXT("adopt_key"), Regenerated.Namespace, Regenerated.Key, Regenerated.Source)) });
	TestEqual(TEXT("adopt_key status"), Status(Adopted), FString(TEXT("ok")));
	TestTrue(TEXT("adopt_key shares the id"), Same(IdOf(Notes->Lines[0]), Regenerated));

	// Taking an id whose text differs is a conflict Unreal resolves with a fresh key; the request is
	// rejected and the earlier action in the same request is rolled back.
	const FId Caption = IdOf(Notes->Info.Caption);
	const FId Gap = IdOf(Notes->Lines[1]);
	TSharedPtr<FJsonObject> Conflict = Run(TEXT("apply"), {
		Action(TEXT("caption"), Path, TEXT("Info.Caption"), Caption, EditJson(TEXT("change_source"), FString(), FString(), TEXT("Harbour"))),
		Action(TEXT("gap"), Path, TEXT("Lines[1]"), Gap, EditJson(TEXT("change_key"), Regenerated.Namespace, Regenerated.Key)) });
	TestEqual(TEXT("Conflict status"), Status(Conflict), FString(TEXT("rejected")));
	TestEqual(TEXT("Conflict code"), FirstErrorCode(Conflict), FString(TEXT("key_conflict")));
	TestTrue(TEXT("Conflicting place unchanged"), Same(IdOf(Notes->Lines[1]), Gap));
	TestTrue(TEXT("Earlier action rolled back"), Same(IdOf(Notes->Info.Caption), Caption));

	// change_source through a struct member, a map value and a fixed array element.
	TSharedPtr<FJsonObject> Retyped = Run(TEXT("apply"), {
		Action(TEXT("caption"), Path, TEXT("Info.Caption"), Caption, EditJson(TEXT("change_source"), FString(), FString(), TEXT("Harbour"))),
		Action(TEXT("label"), Path, TEXT("Labels{0}.value"), IdOf(Notes->Labels[TEXT("Door")]),
			EditJson(TEXT("change_source"), FString(), FString(), TEXT("Barred"))),
		Action(TEXT("fixed"), Path, TEXT("Fixed[1]"), IdOf(Notes->Fixed[1]),
			EditJson(TEXT("change_source"), FString(), FString(), TEXT("Two"))) });
	TestEqual(TEXT("change_source status"), Status(Retyped), FString(TEXT("ok")));
	TestEqual(TEXT("Struct member retyped"), IdOf(Notes->Info.Caption).Source, FString(TEXT("Harbour")));
	TestEqual(TEXT("Map value retyped"), IdOf(Notes->Labels[TEXT("Door")]).Source, FString(TEXT("Barred")));
	TestEqual(TEXT("Fixed array element retyped"), IdOf(Notes->Fixed[1]).Source, FString(TEXT("Two")));
	TestEqual(TEXT("A sole text keeps its key when retyped"), IdOf(Notes->Info.Caption).Key, Caption.Key);

	// A nested subobject named as the saved-package reader writes it, with '.' after the asset.
	UUEShedGameTextTestObject* Child = NewObject<UUEShedGameTextTestObject>(Notes, TEXT("Child"), RF_Transactional);
	UUEShedGameTextTestObject* Leaf = NewObject<UUEShedGameTextTestObject>(Child, TEXT("Leaf"), RF_Transactional);
	Type(Package, Leaf->Title, TEXT("Nested"));
	FString DottedLeaf = Leaf->GetPathName();
	DottedLeaf.ReplaceInline(TEXT(":"), TEXT("."));
	TestEqual(TEXT("A dotted subobject path resolves"), Status(Run(TEXT("apply"),
		{ Action(TEXT("leaf"), DottedLeaf, TEXT("Title"), IdOf(Leaf->Title), EditJson(TEXT("change_source"), FString(), FString(), TEXT("Nested text"))) })),
		FString(TEXT("ok")));
	TestEqual(TEXT("The nested subobject was edited"), IdOf(Leaf->Title).Source, FString(TEXT("Nested text")));

	// Places that cannot be edited.
	const FId Invariant{ FString(), TEXT("x"), TEXT("v1.0") };
	TestEqual(TEXT("Culture-invariant text is read-only"), FirstErrorCode(Run(TEXT("dry_run"),
		{ Action(TEXT("a"), Path, TEXT("Lines[2]"), Invariant, EditJson(TEXT("regenerate_key"))) })), FString(TEXT("read_only_text")));
	TestEqual(TEXT("A non-text property is not text"), FirstErrorCode(Run(TEXT("dry_run"),
		{ Action(TEXT("a"), Path, TEXT("Count"), Invariant, EditJson(TEXT("regenerate_key"))) })), FString(TEXT("not_text")));
	TestEqual(TEXT("A missing element is not found"), FirstErrorCode(Run(TEXT("dry_run"),
		{ Action(TEXT("a"), Path, TEXT("Lines[9]"), Invariant, EditJson(TEXT("regenerate_key"))) })), FString(TEXT("place_not_found")));
	TestEqual(TEXT("A missing object is not found"), FirstErrorCode(Run(TEXT("dry_run"),
		{ Action(TEXT("a"), Path + TEXT("_Missing"), TEXT("Title"), Invariant, EditJson(TEXT("regenerate_key"))) })),
		FString(TEXT("place_not_found")));
	UDataTable* Table = NewObject<UDataTable>(Package, TEXT("DT_Rows"));
	// A table without a row struct logs an error when it is destroyed.
	Table->RowStruct = FTableRowBase::StaticStruct();
	TestEqual(TEXT("DataTables stay with authoring"), FirstErrorCode(Run(TEXT("dry_run"),
		{ Action(TEXT("a"), Table->GetPathName(), TEXT("RowStruct"), Invariant, EditJson(TEXT("regenerate_key"))) })),
		FString(TEXT("unsupported_place")));

	// Malformed requests change nothing.
	TestEqual(TEXT("Not JSON"), RunRaw(TEXT("nope")), FString(TEXT("rejected:invalid_request")));
	TestEqual(TEXT("Wrong contract"), RunRaw(TEXT("{\"contract\":\"other\",\"version\":\"1.0\",\"mode\":\"apply\",\"actions\":[]}")),
		FString(TEXT("rejected:invalid_request")));
	TestEqual(TEXT("No actions"), RunRaw(TEXT("{\"contract\":\"ue-shed-game-text-actions\",\"version\":\"1.0\",\"mode\":\"apply\",\"actions\":[]}")),
		FString(TEXT("rejected:invalid_request")));
	TestEqual(TEXT("Duplicate place"), Status(Run(TEXT("dry_run"), {
		Action(TEXT("a"), Path, TEXT("Title"), Invariant, EditJson(TEXT("regenerate_key"))),
		Action(TEXT("b"), Path, TEXT("Title"), Invariant, EditJson(TEXT("regenerate_key"))) })), FString(TEXT("rejected")));

	Notes->ClearFlags(RF_Public | RF_Standalone);
	Package->SetDirtyFlag(false);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUEShedGameTextBlueprintTest, "UEShed.GameText.Blueprint",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FUEShedGameTextBlueprintTest::RunTest(const FString& Parameters)
{
	UPackage* Package = TestPackage(TEXT("BP_Sign"));
	UBlueprint* Sign = FKismetEditorUtilities::CreateBlueprint(AActor::StaticClass(), Package, TEXT("BP_Sign"), BPTYPE_Normal,
		UBlueprint::StaticClass(), UBlueprintGeneratedClass::StaticClass());
	if (!TestNotNull(TEXT("Create an actor Blueprint"), Sign)) return false;
	USCS_Node* Node = Sign->SimpleConstructionScript->CreateNode(UTextRenderComponent::StaticClass(), TEXT("Plate"));
	Sign->SimpleConstructionScript->AddNode(Node);
	UTextRenderComponent* Plate = CastChecked<UTextRenderComponent>(Node->ComponentTemplate);
	Type(Package, Plate->Text, TEXT("Harbor Road"));
	FEdGraphPinType TextType;
	TextType.PinCategory = UEdGraphSchema_K2::PC_Text;
	if (!TestTrue(TEXT("Add a text variable"), FBlueprintEditorUtils::AddMemberVariable(Sign, TEXT("Greeting"), TextType))) return false;
	FKismetEditorUtilities::CompileBlueprint(Sign);
	FTextProperty* Greeting = CastField<FTextProperty>(Sign->GeneratedClass->FindPropertyByName(TEXT("Greeting")));
	if (!TestNotNull(TEXT("Compiled variable"), Greeting)) return false;
	Type(Package, *Greeting->ContainerPtrToValuePtr<FText>(Sign->GeneratedClass->GetDefaultObject()), TEXT("Welcome, traveler"));
	FBlueprintEditorUtils::MarkBlueprintAsModified(Sign);
	FKismetEditorUtilities::CompileBlueprint(Sign);

	auto DefaultGreeting = [Sign]()
	{
		const FTextProperty* Property = CastField<FTextProperty>(Sign->GeneratedClass->FindPropertyByName(TEXT("Greeting")));
		return IdOf(*Property->ContainerPtrToValuePtr<FText>(Sign->GeneratedClass->GetDefaultObject()));
	};
	const FString DefaultsPath = Sign->GeneratedClass->GetDefaultObject()->GetPathName();
	const FString PlatePath = Sign->SimpleConstructionScript->FindSCSNode(TEXT("Plate"))->ComponentTemplate->GetPathName();
	const FId Welcome = DefaultGreeting();
	const FId Road = IdOf(Plate->Text);
	TestEqual(TEXT("Variable default typed"), Welcome.Source, FString(TEXT("Welcome, traveler")));

	if (!TestTrue(TEXT("Save Blueprint baseline"), SaveTestPackage(Package))) return false;
	ON_SCOPE_EXIT { IFileManager::Get().Delete(*PackageFile(Package)); };
	const TArray<uint8> BeforeBytes = PackageBytes(Package);
	UBlueprintEditorSettings* Settings = GetMutableDefault<UBlueprintEditorSettings>();
	const auto PreviousSaveOnCompile = Settings->SaveOnCompile;
	Settings->SaveOnCompile = SoC_Always;
	ON_SCOPE_EXIT { Settings->SaveOnCompile = PreviousSaveOnCompile; };
	TSharedPtr<FJsonObject> Result = Run(TEXT("apply"), {
		Action(TEXT("greeting"), DefaultsPath, TEXT("Greeting"), Welcome, EditJson(TEXT("change_key"), TEXT("Sign"), TEXT("Greeting"))),
		Action(TEXT("plate"), PlatePath, TEXT("Text"), Road, EditJson(TEXT("change_source"), FString(), FString(), TEXT("Harbour Road"))) });
	TestEqual(TEXT("Blueprint apply status"), Status(Result), FString(TEXT("ok")));
	TestEqual(TEXT("Blueprint apply error"), FirstErrorCode(Result), FString());
	const TArray<TSharedPtr<FJsonValue>>* Blueprints = nullptr;
	TestTrue(TEXT("The owning Blueprint compiled once"), Result.IsValid() && Result->TryGetArrayField(TEXT("blueprints"), Blueprints)
		&& Blueprints->Num() == 1 && (*Blueprints)[0]->AsObject()->GetBoolField(TEXT("compiled")));
	TestTrue(TEXT("The class default keeps the new id after compiling"),
		Same(DefaultGreeting(), { TEXT("Sign"), TEXT("Greeting"), TEXT("Welcome, traveler") }));
	TestEqual(TEXT("The component template keeps the new source"), IdOf(CastChecked<UTextRenderComponent>(
		Sign->SimpleConstructionScript->FindSCSNode(TEXT("Plate"))->ComponentTemplate)->Text).Source, FString(TEXT("Harbour Road")));

	TestTrue(TEXT("save:false leaves disk bytes unchanged with Save on Compile Always"), PackageBytes(Package) == BeforeBytes);
	if (!TestTrue(TEXT("Save the next rollback baseline"), SaveTestPackage(Package))) return false;
	const TArray<uint8> RollbackBytes = PackageBytes(Package);
	const FId BeforeFailure = DefaultGreeting();
	int32 Compiles = 0;
	const FDelegateHandle Handle = Sign->OnCompiled().AddLambda([&Compiles](UBlueprint* Blueprint)
	{
		// An editor observer changes a value before readback, forcing the post-compile rejection path.
		if (++Compiles != 1) return;
		FTextProperty* Property = CastFieldChecked<FTextProperty>(Blueprint->GeneratedClass->FindPropertyByName(TEXT("Greeting")));
		Type(Blueprint->GetPackage(), *Property->ContainerPtrToValuePtr<FText>(Blueprint->GeneratedClass->GetDefaultObject()), TEXT("Changed during compile"));
	});
	ON_SCOPE_EXIT { Sign->OnCompiled().Remove(Handle); };
	const TSharedPtr<FJsonObject> Failed = Run(TEXT("apply"), {
		Action(TEXT("greeting"), DefaultsPath, TEXT("Greeting"), BeforeFailure, EditJson(TEXT("regenerate_key"))) });
	TestEqual(TEXT("Readback failure status"), Status(Failed), FString(TEXT("failed")));
	TestEqual(TEXT("Readback failure code"), FirstErrorCode(Failed), FString(TEXT("not_persisted")));
	TestTrue(TEXT("Normal and rollback compiles ran"), Compiles >= 2);
	TestTrue(TEXT("Rollback verified restored text"), Failed->GetBoolField(TEXT("rolledBack")) && Same(DefaultGreeting(), BeforeFailure));
	TestTrue(TEXT("Rollback compile leaves saved bytes unchanged"), PackageBytes(Package) == RollbackBytes);

	Package->SetDirtyFlag(false);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FUEShedGameTextSaveRecoveryTest, "UEShed.GameText.SaveRecovery",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FUEShedGameTextSaveRecoveryTest::RunTest(const FString& Parameters)
{
	UPackage* Writable = TestPackage(TEXT("Writable"));
	UPackage* ReadOnly = TestPackage(TEXT("ReadOnly"));
	UUEShedGameTextTestObject* A = NewObject<UUEShedGameTextTestObject>(Writable, TEXT("Notes"), RF_Public | RF_Standalone);
	UUEShedGameTextTestObject* B = NewObject<UUEShedGameTextTestObject>(ReadOnly, TEXT("Notes"), RF_Public | RF_Standalone);
	Type(Writable, A->Title, TEXT("Writable text"));
	Type(ReadOnly, B->Title, TEXT("Read-only text"));
	if (!TestTrue(TEXT("Save both baselines"), SaveTestPackage(Writable) && SaveTestPackage(ReadOnly))) return false;
	const FString ReadOnlyFile = PackageFile(ReadOnly);
	ON_SCOPE_EXIT
	{
		FPlatformFileManager::Get().GetPlatformFile().SetReadOnly(*ReadOnlyFile, false);
		IFileManager::Get().Delete(*ReadOnlyFile);
		IFileManager::Get().Delete(*PackageFile(Writable));
		Writable->SetDirtyFlag(false);
		ReadOnly->SetDirtyFlag(false);
	};
	const TArray<uint8> WritableBytes = PackageBytes(Writable);
	const TArray<uint8> ReadOnlyBytes = PackageBytes(ReadOnly);
	const FId BeforeA = IdOf(A->Title);
	const FId BeforeB = IdOf(B->Title);
	if (!TestTrue(TEXT("Make one file read-only"), FPlatformFileManager::Get().GetPlatformFile().SetReadOnly(*ReadOnlyFile, true))) return false;
	const TSharedPtr<FJsonObject> Result = Run(TEXT("apply"), {
		Action(TEXT("writable"), A->GetPathName(), TEXT("Title"), BeforeA, EditJson(TEXT("regenerate_key"))),
		Action(TEXT("read-only"), B->GetPathName(), TEXT("Title"), BeforeB, EditJson(TEXT("regenerate_key"))) }, true, true);
	TestEqual(TEXT("Partial save fails"), Status(Result), FString(TEXT("failed")));
	TestFalse(TEXT("Retained edits are not rolled back"), Result->GetBoolField(TEXT("rolledBack")));
	for (const TSharedPtr<FJsonValue>& Item : Result->GetArrayField(TEXT("actions")))
		TestEqual(TEXT("Retained mutations remain applied"), Item->AsObject()->GetStringField(TEXT("status")), FString(TEXT("applied")));
	int32 Saved = 0;
	int32 Unsaved = 0;
	for (const TSharedPtr<FJsonValue>& Item : Result->GetArrayField(TEXT("packages")))
	{
		const TSharedPtr<FJsonObject> Package = Item->AsObject();
		if (Package->GetBoolField(TEXT("saved"))) ++Saved;
		if (Package->GetStringField(TEXT("persistence")) == TEXT("unsaved")) ++Unsaved;
	}
	TestEqual(TEXT("One file saved"), Saved, 1);
	TestEqual(TEXT("One known unsaved file"), Unsaved, 1);
	TestTrue(TEXT("Writable package changed on disk"), PackageBytes(Writable) != WritableBytes);
	TestTrue(TEXT("Read-only package stayed unchanged on disk"), PackageBytes(ReadOnly) == ReadOnlyBytes);
	const TSharedPtr<FJsonObject> Error = Result->GetArrayField(TEXT("errors"))[0]->AsObject();
	TestEqual(TEXT("Save error requires reconciliation"), Error->GetStringField(TEXT("nextStep")), FString(TEXT("reconcile")));
	TestFalse(TEXT("Replaying edits is unsafe"), Error->GetBoolField(TEXT("retrySafe")));
	const FId RetainedB = IdOf(B->Title);
	TestTrue(TEXT("Both keys changed in memory"), IdOf(A->Title).Key != BeforeA.Key && RetainedB.Key != BeforeB.Key);
	FPlatformFileManager::Get().GetPlatformFile().SetReadOnly(*ReadOnlyFile, false);
	TestTrue(TEXT("Explicit persistence succeeds without replay"), SaveTestPackage(ReadOnly));
	TestTrue(TEXT("Persistence recovery retains generated key"), Same(IdOf(B->Title), RetainedB));
	TestTrue(TEXT("Recovered save changes disk bytes"), PackageBytes(ReadOnly) != ReadOnlyBytes);

	const TSharedRef<FJsonObject> WrongFile = Action(TEXT("wrong-file"), A->GetPathName(), TEXT("Title"), IdOf(A->Title), EditJson(TEXT("regenerate_key")));
	WrongFile->GetObjectField(TEXT("place"))->SetStringField(TEXT("packageFile"), ReadOnlyFile + TEXT(".missing"));
	const FId Unchanged = IdOf(A->Title);
	TestEqual(TEXT("An unmounted file is rejected"), FirstErrorCode(Run(TEXT("apply"), { WrongFile })), FString(TEXT("package_mismatch")));
	TestTrue(TEXT("Rejected binding leaves text unchanged"), Same(IdOf(A->Title), Unchanged));
	return true;
}

#endif
