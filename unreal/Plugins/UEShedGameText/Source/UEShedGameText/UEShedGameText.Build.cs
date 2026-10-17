using UnrealBuildTool;

public class UEShedGameText : ModuleRules
{
	public UEShedGameText(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new[] { "BlueprintGraph", "Json", "UEShedCore", "UnrealEd" });
	}
}
