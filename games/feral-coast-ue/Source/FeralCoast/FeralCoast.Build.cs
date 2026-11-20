using UnrealBuildTool;

public class FeralCoast : ModuleRules
{
	public FeralCoast(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "AIModule", "Json", "JsonUtilities", "AssetRegistry"
		});
	}
}
