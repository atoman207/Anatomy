using UnrealBuildTool;

public class LabnoteAvatar : ModuleRules
{
	public LabnoteAvatar(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		// Deliberately no dependency on the Pixel Streaming or NVIDIA ACE modules:
		// those are wired in Blueprint (see README.md), so this plugin builds on
		// any UE 5.x without matching plugin versions.
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"Json",
		});
	}
}
