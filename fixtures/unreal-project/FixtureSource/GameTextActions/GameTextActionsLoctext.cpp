// Gather-only C++ text for the GameTextActions identity cases (Plan 058 A4). This file is not
// compiled: Unreal's GatherTextFromSource reads it as text (GameTextActions_Source.ini), and the
// saved-package reader never sees C++ text, so the case checks only what Unreal gathers.

#define LOCTEXT_NAMESPACE "GameTextActions.Source"

FText HarborClosed()
{
	return LOCTEXT("HarborClosed", "The harbor is closed");
}

FText HarborClosedAgain()
{
	// The same id and text in a second place: one manifest entry with two sources.
	return LOCTEXT("HarborClosed", "The harbor is closed");
}

#undef LOCTEXT_NAMESPACE

FText TideTable()
{
	return NSLOCTEXT("GameTextActions.Tides", "TideTable", "Tide table");
}
