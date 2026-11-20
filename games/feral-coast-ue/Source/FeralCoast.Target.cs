using UnrealBuildTool;

public class FeralCoastTarget : TargetRules
{
	public FeralCoastTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V2;
		ExtraModuleNames.Add("FeralCoast");
	}
}
