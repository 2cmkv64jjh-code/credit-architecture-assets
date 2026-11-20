using UnrealBuildTool;

public class FeralCoastEditorTarget : TargetRules
{
	public FeralCoastEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V2;
		ExtraModuleNames.Add("FeralCoast");
	}
}
