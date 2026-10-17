#include "UEShedGameTextActions.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "Tests/UEShedGameTextTestTypes.h"
#include "Components/TextRenderComponent.h"
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
	return CreatePackage(*FString::Printf(TEXT("/Temp/UEShedGameTextTest/%s_%s"), Name,
		*FGuid::NewGuid().ToString(EGuidFormats::Digits)));
}

TSharedRef<FJsonObject> Action(const FString& Id, const FString& ObjectPath, const FString& PropertyPath, const FId& Expected,
	const TSharedRef<FJsonObject>& Edit)
{
	const TSharedRef<FJsonObject> Place = MakeShared<FJsonObject>();
	Place->SetStringField(TEXT("objectPath"), ObjectPath);
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

	Package->SetDirtyFlag(false);
	return true;
}

#endif
